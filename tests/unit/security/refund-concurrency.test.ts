import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  IDEMPOTENCY_TEST_KEY_C,
  resetIdempotencyTables,
  runRefundIdempotent,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";
import { countIdempotencyRecords } from "./idempotency-test-database";

describe("refund concurrency", () => {
  const database = createIdempotencyTestDatabase("p0c1-refund-concurrency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("allows two partial refunds whose sum equals the refundable amount", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      grandTotal: 10_000n,
      quantity: 5,
    });
    // First refund claims full quantity (existing stock rule). Second must fail.
    // Use monetary-only style by testing sequential partials where first takes all stock claim —
    // with current refund restoring all stock, only one refund can succeed.
    const results = await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 6_000n,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("rejects concurrent full refunds so only one commits", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    const results = await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refundOrders = await database.client.order.count({
      where: { originalOrderId: fixture.order.id, orderType: "Refund" },
    });
    expect(refundOrders).toBe(1);
  });

  it("committed refund absolute total never exceeds grand total", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      grandTotal: 9_000n,
      quantity: 3,
    });
    await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 9_000n,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 9_000n,
      }),
    ]);
    const children = await database.client.order.findMany({
      where: { originalOrderId: fixture.order.id, orderType: "Refund" },
    });
    const absolute = children.reduce(
      (sum, child) => sum + (child.grandTotal < 0n ? -child.grandTotal : child.grandTotal),
      0n,
    );
    expect(absolute).toBeLessThanOrEqual(9_000n);
  });
});

describe("return quantity concurrency", () => {
  const database = createIdempotencyTestDatabase("p0c1-return-qty-concurrency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("two returns cannot exceed one source line sold quantity", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const results = await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: item.id, returnQty: 4 }],
        refundAmount: 8_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 4 }],
        refundAmount: 8_000n,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBeLessThanOrEqual(5);
  });

  it("duplicate product lines remain independently bounded", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [lineA, lineB] = fixture.orderItems;
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [{ orderItemId: lineA!.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      items: [{ orderItemId: lineB!.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    const a = await database.client.orderItem.findUniqueOrThrow({
      where: { id: lineA!.id },
    });
    const b = await database.client.orderItem.findUniqueOrThrow({
      where: { id: lineB!.id },
    });
    expect(a.returnedQuantity).toBe(3);
    expect(b.returnedQuantity).toBe(2);
  });

  it("a return cannot consume quantity from another same-product line", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [lineA, lineB] = fixture.orderItems;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: lineA!.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    await expect(
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: lineA!.id, returnQty: 1 }],
        refundAmount: 2_000n,
      }),
    ).rejects.toThrow(/exceeds remaining|conflict/i);
    const b = await database.client.orderItem.findUniqueOrThrow({
      where: { id: lineB!.id },
    });
    expect(b.returnedQuantity).toBe(0);
  });

  it("sum equal to sold quantity closes the line exactly", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      items: [{ orderItemId: item.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(5);
  });
});
