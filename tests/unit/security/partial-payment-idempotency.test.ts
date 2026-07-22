import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { applyPartialPayment } from "@/lib/services/order-service";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import {
  countAudits,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";

describe("partial payment idempotency (executeFinancialIdempotent + applyPartialPayment)", () => {
  const database = createIdempotencyTestDatabase("p0a-partial-payment");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runPartialPayment(input: {
    rawKey?: string;
    orderId: number;
    userId: number;
    amount: bigint;
    paymentMethodId?: number;
  }) {
    const requestPayload = {
      orderId: input.orderId,
      paymentMethodId: input.paymentMethodId ?? 1,
      amount: input.amount,
      referenceNo: null,
    };

    return executeFinancialIdempotent({
      rawKey: input.rawKey ?? IDEMPOTENCY_TEST_KEY,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: input.orderId,
      actorUserId: input.userId,
      authoritativeTerminalId: 1,
      requestPayload,
      client: database.client,
      execute: async (tx) => {
        const paymentResult = await applyPartialPayment(
          {
            orderId: input.orderId,
            paymentMethodId: input.paymentMethodId ?? 1,
            amount: input.amount,
            userId: input.userId,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(paymentResult) };
      },
    });
  }

  it("creates exactly one Partial payment for a partial amount below the grand total", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    const result = await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    expect(result.replayed).toBe(false);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.status).toBe("Partial");
    expect(payment.amount).toBe(2_000n);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
  });

  it("computes paidTotal and remaining correctly for a known fixture", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    const result = await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    const body = result.body as unknown as {
      paidTotal: string;
      remaining: string;
    };
    expect(body.paidTotal).toBe("2000");
    expect(body.remaining).toBe("3000");
  });

  it("replays without creating a second payment or audit", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });
    const second = await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    expect(second.replayed).toBe(true);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(1);
  });

  it("rejects a reused key with a different amount as a payload mismatch", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    await expect(
      runPartialPayment({
        orderId: fixture.order.id,
        userId: fixture.user.id,
        amount: 3_000n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
  });

  it("closes the order and processes completion exactly once when two idempotent partial payments together cover the grand total", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });
    const final = await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 3_000n,
    });

    expect(final.replayed).toBe(false);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");

    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(2);
    const payments = await database.client.payment.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(payments.every((payment) => payment.status === "Paid")).toBe(true);

    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("does not double-process completion when the completing payment is replayed", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });

    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });
    await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 3_000n,
    });
    const replay = await runPartialPayment({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 3_000n,
    });

    expect(replay.replayed).toBe(true);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(2);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(2);
  });

  it("writes one sale cash-drawer log per real partial payment when a shift is attached to the order", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
      shiftAttached: true,
    });

    await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });
    await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    await expect(
      database.client.cashDrawerLog.count({ where: { shiftId: fixture.shift.id } }),
    ).resolves.toBe(1);
  });

  it("does not write a cash-drawer log when the order has no shift attached", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
      shiftAttached: false,
    });

    await runPartialPayment({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      amount: 2_000n,
    });

    await expect(
      database.client.cashDrawerLog.count({ where: { shiftId: fixture.shift.id } }),
    ).resolves.toBe(0);
  });
});
