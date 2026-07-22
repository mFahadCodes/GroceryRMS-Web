import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countIdempotencyRecords,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  runRefundIdempotent,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";

describe("refund versus return cross-operation", () => {
  const database = createIdempotencyTestDatabase("p0c1-refund-return-cross");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("refund and return cannot restore the same units twice", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 4,
      grandTotal: 8_000n,
    });
    const item = fixture.orderItems[0]!;
    const results = await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 8_000n,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 4 }],
        refundAmount: 8_000n,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(1);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(4);
  });

  it("return then refund conflicts without a second stock movement", async () => {
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
    await expect(
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 6_000n,
      }),
    ).rejects.toThrow();
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(1);
  });

  it("shared monetary boundary prevents over-refund across return and refund", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    // Partial return of 2 units leaves remaining monetary room, but refund
    // still claims full line quantity and must conflict after any return.
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [{ orderItemId: item.id, returnQty: 1 }],
      refundAmount: 2_000n,
    });
    await expect(
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 8_000n,
      }),
    ).rejects.toThrow();
  });

  it("winner leaves exactly one success audit among REFUND_ORDER and RETURN", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    const item = fixture.orderItems[0]!;
    await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 5 }],
        refundAmount: fixture.grandTotal,
      }),
    ]);
    const refundAudits = await countAudits(database.client, "REFUND_ORDER");
    const returnAudits = await countAudits(database.client, "RETURN");
    expect(refundAudits + returnAudits).toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });
});
