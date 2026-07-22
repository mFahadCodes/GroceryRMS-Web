import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { applyPartialPayment, checkoutFast } from "@/lib/services/order-service";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  countStockMovements,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";

describe("checkout financial invariants (through executeFinancialIdempotent)", () => {
  const database = createIdempotencyTestDatabase("p0a-financial-checkout");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runCheckout(input: {
    orderId: number;
    userId: number;
    terminalId: number;
    tenderedAmount: bigint;
    discountPercent?: number;
    taxPercent?: number;
  }) {
    return executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: input.orderId,
      actorUserId: input.userId,
      authoritativeTerminalId: input.terminalId,
      requestPayload: {
        orderId: input.orderId,
        paymentMethodId: 1,
        tenderedAmount: input.tenderedAmount,
        terminalId: input.terminalId,
        discountPercent: input.discountPercent ?? 0,
        taxPercent: input.taxPercent ?? 0,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: input.orderId,
            paymentMethodId: 1,
            tenderedAmount: input.tenderedAmount,
            terminalId: input.terminalId,
            cashierId: input.userId,
            discountPercent: input.discountPercent,
            taxPercent: input.taxPercent,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });
  }

  it("the single payment amount equals the order's recomputed grand total", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_000n,
      quantity: 2,
    });
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(payment.amount).toBe(order.grandTotal);
    expect(order.grandTotal).toBe(2_000n);
    expect(order.status).toBe("Closed");
  });

  it("recomputes the grand total with a discount and charges exactly that amount — not the raw line total", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_000n,
      quantity: 2, // subTotal 2000
    });

    const result = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: 1_800n,
      discountPercent: 10, // 10% of 2000 = 200 discount
      taxPercent: 0,
    });

    const body = result.body as unknown as { grandTotal: string };
    expect(body.grandTotal).toBe("1800");

    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.amount).toBe(1_800n);
  });

  it("decrements stock by exactly the line item quantity via a single negated Sale movement", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 500n,
      quantity: 3,
      stock: 50,
    });
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);

    const movement = await database.client.stockMovement.findFirstOrThrow({
      where: { productId: fixture.product.id, type: "Sale" },
    });
    expect(Number(movement.quantity)).toBe(-3);

    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(47);
  });

  it("keeps the paid total equal to the grand total after a replay (never double-charges)", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_000n,
      quantity: 2,
    });
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    const payments = await database.client.payment.findMany({
      where: { orderId: fixture.order.id },
    });
    const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0n);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(paidTotal).toBe(order.grandTotal);
  });

  it("records the checkout audit's grandTotal metadata consistently with the persisted order total", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_000n,
      quantity: 2,
    });
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CHECKOUT", recordId: fixture.order.id },
    });
    const metadata = JSON.parse(audit.newValues!);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(metadata.grandTotal).toBe(order.grandTotal.toString());
    expect(metadata.paymentCount).toBe(1);
  });
});

describe("partial payment financial invariants (through executeFinancialIdempotent)", () => {
  const database = createIdempotencyTestDatabase("p0a-financial-partial");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runPartialPayment(input: {
    rawKey: string;
    orderId: number;
    userId: number;
    amount: bigint;
  }) {
    return executeFinancialIdempotent({
      rawKey: input.rawKey,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: input.orderId,
      actorUserId: input.userId,
      authoritativeTerminalId: 1,
      requestPayload: { orderId: input.orderId, paymentMethodId: 1, amount: input.amount },
      client: database.client,
      execute: async (tx) => {
        const result = await applyPartialPayment(
          { orderId: input.orderId, paymentMethodId: 1, amount: input.amount, userId: input.userId },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });
  }

  it("a single partial payment leaves remaining = grandTotal - amount, and the order PartiallyPaid", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });

    const result = await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 4_000n,
    });

    const body = result.body as unknown as { paidTotal: string; remaining: string };
    expect(body.paidTotal).toBe("4000");
    expect(body.remaining).toBe("6000");

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
  });

  it("two idempotent partial payments that sum to the grand total close the order with remaining = 0", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 4_000n,
    });
    const final = await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 6_000n,
    });

    const body = final.body as unknown as { paidTotal: string; remaining: string };
    expect(body.paidTotal).toBe("10000");
    expect(body.remaining).toBe("0");

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
  });

  it("processes stock completion exactly once, on the payment that crosses the grand total", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 4_000n,
    });
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(0);

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 6_000n,
    });
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("upgrades every prior Partial payment to Paid once the order is fully covered", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 4_000n,
    });
    const firstPayment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(firstPayment.status).toBe("Partial");

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 6_000n,
    });

    const payments = await database.client.payment.findMany({
      where: { orderId: fixture.order.id },
      orderBy: { id: "asc" },
    });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === "Paid")).toBe(true);
    const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0n);
    expect(paidTotal).toBe(10_000n);
  });
});
