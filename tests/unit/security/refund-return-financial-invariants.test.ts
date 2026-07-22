import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
  runRefundIdempotent,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";
import { countStockMovements } from "./idempotency-test-database";

describe("refund/return financial and stock invariants", () => {
  const database = createIdempotencyTestDatabase("p0c1-financial-invariants");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("refund payment amount is negative of the refunded value", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      grandTotal: 7_000n,
      quantity: 7,
    });
    await runRefundIdempotent(database.client, fixture, { amount: 7_000n });
    const payment = await database.client.payment.findFirstOrThrow({
      where: { status: "Refunded" },
    });
    expect(payment.amount).toBe(-7_000n);
  });

  it("return refundAmount is stored as negative payment and order totals", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const result = await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    const body = result.body as { refundOrderId: number };
    const refundOrder = await database.client.order.findUniqueOrThrow({
      where: { id: body.refundOrderId },
    });
    expect(refundOrder.grandTotal).toBe(-4_000n);
    expect(refundOrder.orderType).toBe("Refund");
  });

  it("return restores exactly the committed quantity to stock", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const before = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    const after = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    expect(after - before).toBe(2);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(1);
  });

  it("source order remains Closed after refund and return", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 1 }],
      refundAmount: 2_000n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
  });

  it("unrelated order is unchanged by a return on another order", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      orderId: 501,
      quantity: 5,
      grandTotal: 10_000n,
    });
    const other = await database.client.order.create({
      data: {
        id: 502,
        orderNumber: "ORD-502",
        orderType: "WalkIn",
        status: "Closed",
        cashierId: fixture.user.id,
        terminalId: fixture.terminalId,
        subTotal: 1_000n,
        grandTotal: 1_000n,
      },
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 1 }],
      refundAmount: 2_000n,
    });
    const untouched = await database.client.order.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(untouched.grandTotal).toBe(1_000n);
    expect(untouched.status).toBe("Closed");
  });
});
