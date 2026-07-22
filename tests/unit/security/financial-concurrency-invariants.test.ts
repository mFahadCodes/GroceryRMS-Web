import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
} from "./idempotency-test-database";
import {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  runCheckoutIdempotent,
  runPartialIdempotent,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./financial-concurrency-harness";

describe("financial concurrency invariants (formulas preserved)", () => {
  const database = createIdempotencyTestDatabase("p0b-concurrency-invariants");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("single checkout still closes with payment equal to grand total", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 2_500n,
      quantity: 2,
    });
    await runCheckoutIdempotent(database.client, fixture);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    expect(order.grandTotal).toBe(5_000n);
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(5_000n);
  });

  it("checkout tender change remains tenderedAmount - amount for cash", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_000n,
      quantity: 1,
    });
    await runCheckoutIdempotent(database.client, fixture, {
      tenderedAmount: 1_500n,
    });
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.amount).toBe(1_000n);
    expect(payment.tenderedAmount).toBe(1_500n);
    expect(payment.changeAmount).toBe(500n);
  });

  it("partial accumulation paidTotal and remaining match committed rows", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    const first = await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 4_000n,
    });
    const body = first.body as unknown as {
      paidTotal: string;
      remaining: string;
    };
    expect(body.paidTotal).toBe("4000");
    expect(body.remaining).toBe("6000");

    const second = await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      amount: 6_000n,
    });
    const body2 = second.body as unknown as {
      paidTotal: string;
      remaining: string;
    };
    expect(body2.paidTotal).toBe("10000");
    expect(body2.remaining).toBe("0");
  });

  it("finalizing partial sets order Closed and payment status Paid", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 3_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      amount: 3_000n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.status).toBe("Paid");
  });

  it("non-final partial sets PartiallyPaid and Partial payment status", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 3_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      amount: 1_000n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.status).toBe("Partial");
  });

  it("stock decrement equals line quantity on checkout", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      stock: 40,
      quantity: 5,
    });
    await runCheckoutIdempotent(database.client, fixture);
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(35);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("cash drawer sale log amount equals payment amount for partial", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 6_000n,
      shiftAttached: true,
    });
    await runPartialIdempotent(database.client, fixture, {
      amount: 2_500n,
    });
    const logs = await database.client.cashDrawerLog.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.amount).toBe(2_500n);
  });

  it("different-key race does not change winner payment method or amount formulas", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.paymentMethodId).toBe(1);
    expect(payment.amount).toBe(fixture.grandTotal);
    expect(payment.status).toBe("Paid");
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
  });
});
