import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  IDEMPOTENCY_TEST_KEY_C,
  resetIdempotencyTables,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";
import { countIdempotencyRecords, countStockMovements } from "./idempotency-test-database";

describe("return quantity concurrency matrix", () => {
  const database = createIdempotencyTestDatabase("p0c1-return-qty-matrix");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("sum below sold quantity accepts both different-key returns", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 6,
      grandTotal: 12_000n,
    });
    const item = fixture.orderItems[0]!;
    const results = await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: item.id, returnQty: 2 }],
        refundAmount: 4_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 2 }],
        refundAmount: 4_000n,
      }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(4);
  });

  it("same quantity with different keys is a distinct attempt", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 3,
      grandTotal: 9_000n,
    });
    const item = fixture.orderItems[0]!;
    const results = await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 9_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 9_000n,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("one return requesting all remaining quantity wins against a concurrent partial", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const results = await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: item.id, returnQty: 5 }],
        refundAmount: 10_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 1 }],
        refundAmount: 2_000n,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(5);
  });

  it("disjoint item sets can both succeed", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [a, b] = fixture.orderItems;
    const results = await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: a!.id, returnQty: 2 }],
        refundAmount: 4_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: b!.id, returnQty: 2 }],
        refundAmount: 4_000n,
      }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("overlapping multi-item request fails entirely when one line exceeds remaining", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [a, b] = fixture.orderItems;
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [{ orderItemId: a!.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    await expect(
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [
          { orderItemId: a!.id, returnQty: 1 },
          { orderItemId: b!.id, returnQty: 1 },
        ],
        refundAmount: 4_000n,
      }),
    ).rejects.toThrow();
    const lineB = await database.client.orderItem.findUniqueOrThrow({
      where: { id: b!.id },
    });
    expect(lineB.returnedQuantity).toBe(0);
  });

  it("three concurrent over-returns leave at most sold quantity restored", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 4,
      grandTotal: 8_000n,
    });
    const item = fixture.orderItems[0]!;
    const before = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    await Promise.allSettled([
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 6_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 6_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 6_000n,
      }),
    ]);
    const after = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    expect(after - before).toBeLessThanOrEqual(4);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBeLessThanOrEqual(4);
    await expect(countIdempotencyRecords(database.client)).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBeLessThanOrEqual(2);
  });
});
