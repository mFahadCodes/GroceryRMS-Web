import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  runRefundIdempotent,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";

describe("refund/return stock invariants", () => {
  const database = createIdempotencyTestDatabase("p0c1-stock-invariants");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("refund restores stock once under different-key contention", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 3,
      grandTotal: 6_000n,
    });
    const before = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    const after = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    expect(after - before).toBe(3);
  });

  it("return stock movement quantity matches claim", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    const movement = await database.client.stockMovement.findFirstOrThrow({
      where: { productId: fixture.product.id, type: "Return" },
    });
    expect(Number(movement.quantity)).toBe(2);
  });

  it("losing concurrent return creates no stock movement", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 2,
      grandTotal: 4_000n,
    });
    const item = fixture.orderItems[0]!;
    await Promise.allSettled([
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
    await expect(
      database.client.stockMovement.count({
        where: { productId: fixture.product.id, type: "Return" },
      }),
    ).resolves.toBe(1);
  });

  it("cash drawer refund log is created at most once for concurrent refunds", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await Promise.allSettled([
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(
      database.client.cashDrawerLog.count({
        where: { type: "Refund", shiftId: fixture.shift.id },
      }),
    ).resolves.toBe(1);
  });

  it("unrelated product stock is unchanged", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 4,
      grandTotal: 8_000n,
    });
    const other = await database.client.product.create({
      data: {
        name: "Other",
        categoryId: 1,
        basePrice: 100n,
        costPrice: 50n,
        currentStock: 50,
      },
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 1 }],
      refundAmount: 2_000n,
    });
    const untouched = await database.client.product.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(Number(untouched.currentStock)).toBe(50);
  });
});
