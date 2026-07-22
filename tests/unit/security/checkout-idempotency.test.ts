import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { checkoutFast } from "@/lib/services/order-service";
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
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
} from "./idempotency-test-database";

describe("checkout idempotency (executeFinancialIdempotent + checkoutFast)", () => {
  const database = createIdempotencyTestDatabase("p0a-checkout");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runCheckout(input: {
    rawKey?: string;
    orderId: number;
    userId: number;
    terminalId: number;
    paymentMethodId?: number;
    tenderedAmount: bigint;
  }) {
    const requestPayload = {
      orderId: input.orderId,
      paymentMethodId: input.paymentMethodId ?? 1,
      tenderedAmount: input.tenderedAmount,
      terminalId: input.terminalId,
      discountPercent: 0,
      taxPercent: 0,
      customerId: null,
      notes: null,
      referenceNo: null,
      redeemPoints: 0n,
      payments: null,
    };

    return executeFinancialIdempotent({
      rawKey: input.rawKey ?? IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: input.orderId,
      actorUserId: input.userId,
      authoritativeTerminalId: input.terminalId,
      requestPayload,
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: input.orderId,
            paymentMethodId: input.paymentMethodId ?? 1,
            tenderedAmount: input.tenderedAmount,
            terminalId: input.terminalId,
            cashierId: input.userId,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });
  }

  it("creates exactly one Paid payment equal to the grand total on first checkout", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const result = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    expect(result.replayed).toBe(false);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.status).toBe("Paid");
    expect(payment.amount).toBe(fixture.grandTotal);
  });

  it("writes exactly one CHECKOUT audit row on first checkout", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
  });

  it("persists exactly one COMPLETED idempotency record on first checkout", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    const records = await database.client.idempotencyRecord.findMany();
    expect(records).toHaveLength(1);
    expect(records[0]!.state).toBe("COMPLETED");
  });

  it("decrements stock exactly once via a single Sale stock movement", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);

    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(20 - fixture.quantity);
  });

  it("replays without creating a second payment, audit, or stock movement", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const first = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    const second = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    expect(second.replayed).toBe(true);
    expect(second.status).toBe(first.status);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("returns the same order id and status on replay as on the original checkout", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const first = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    const second = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    const firstBody = first.body as { id: number; status: string };
    const secondBody = second.body as { id: number; status: string };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.status).toBe(firstBody.status);
    expect(secondBody.status).toBe("Closed");
  });

  it("marks replayed:false on the first call and replayed:true on every later call with the same key", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const first = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    const second = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });
    const third = await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
  });

  it("rejects a reused key with a different tendered amount as a payload mismatch", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    await expect(
      runCheckout({
        orderId: fixture.order.id,
        userId: fixture.user.id,
        terminalId: fixture.terminalId!,
        tenderedAmount: fixture.grandTotal + 500n,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });

  it("does not create a second payment when a mismatched retry is rejected", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    await expect(
      runCheckout({
        orderId: fixture.order.id,
        userId: fixture.user.id,
        terminalId: fixture.terminalId!,
        tenderedAmount: fixture.grandTotal + 500n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
  });

  it("a different actor reusing the same raw key on the same order gets a fresh scope, but the underlying checkout still fails once the order is already closed", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.user.create({
      data: {
        id: fixture.user.id + 1,
        username: "second-cashier",
        fullName: "Second Cashier",
        passwordHash: "test-only-password-hash",
        roleId: 1,
      },
    });
    await database.client.shift.create({
      data: {
        userId: fixture.user.id + 1,
        terminalId: fixture.terminalId!,
        openingBalance: 5_000n,
      },
    });

    await runCheckout({
      orderId: fixture.order.id,
      userId: fixture.user.id,
      terminalId: fixture.terminalId!,
      tenderedAmount: fixture.grandTotal,
    });

    await expect(
      runCheckout({
        orderId: fixture.order.id,
        userId: fixture.user.id + 1,
        terminalId: fixture.terminalId!,
        tenderedAmount: fixture.grandTotal,
      }),
    ).rejects.toThrow(/not open/i);

    // The second actor's own scope started a transaction that failed inside
    // checkoutFast, so its IN_PROGRESS row is rolled back along with the
    // rest of the failed transaction — only the first actor's COMPLETED
    // record remains, and there is still only one real payment on the order.
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
  });
});
