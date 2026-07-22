import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { applyPartialPayment, checkoutFast } from "@/lib/services/order-service";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  countAudits,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";

const FAIL_AUDIT_TRIGGER = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("idempotency rollback on audit failure", () => {
  const database = createIdempotencyTestDatabase("p0a-rollback");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runCheckout(fixture: Awaited<ReturnType<typeof seedCheckoutOrderFixture>>) {
    return executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: fixture.grandTotal,
        terminalId: fixture.terminalId,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            tenderedAmount: fixture.grandTotal,
            terminalId: fixture.terminalId!,
            cashierId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });
  }

  it("rolls back the payment, stock movement, and idempotency record when the audit insert is aborted", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);

    try {
      await expect(runCheckout(fixture)).rejects.toThrow();

      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");

      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(0);
      await expect(
        countStockMovements(database.client, fixture.product.id, "Sale"),
      ).resolves.toBe(0);
      await expect(database.client.idempotencyRecord.count()).resolves.toBe(0);
      await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    }
  });

  it("does not leave a stray IN_PROGRESS idempotency record after the rollback", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);

    try {
      await expect(runCheckout(fixture)).rejects.toThrow();
      await expect(database.client.idempotencyRecord.count()).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    }
  });

  it("leaves the product's stock at its original level after the rollback", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);

    try {
      await expect(runCheckout(fixture)).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    }

    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(20);
  });

  it("succeeds exactly once after the trigger is removed and the same key is retried", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    await expect(runCheckout(fixture)).rejects.toThrow();
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");

    const result = await runCheckout(fixture);
    expect(result.replayed).toBe(false);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
  });

  it("survives repeated failed attempts and still only completes once on the eventual retry", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    await expect(runCheckout(fixture)).rejects.toThrow();
    await expect(runCheckout(fixture)).rejects.toThrow();
    await expect(runCheckout(fixture)).rejects.toThrow();
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");

    await runCheckout(fixture);
    const replay = await runCheckout(fixture);

    expect(replay.replayed).toBe(true);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
  });
});

describe("partial payment idempotency rollback on audit failure", () => {
  const database = createIdempotencyTestDatabase("p0a-rollback-partial");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runPartialPayment(
    fixture: Awaited<ReturnType<typeof seedPartialPaymentOrderFixture>>,
    amount: bigint,
  ) {
    return executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: 1,
      requestPayload: { orderId: fixture.order.id, paymentMethodId: 1, amount },
      client: database.client,
      execute: async (tx) => {
        const result = await applyPartialPayment(
          { orderId: fixture.order.id, paymentMethodId: 1, amount, userId: fixture.user.id },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });
  }

  it("rolls back the partial payment and idempotency record when the audit insert is aborted", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);

    try {
      await expect(runPartialPayment(fixture, 2_000n)).rejects.toThrow();

      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(0);
      await expect(database.client.idempotencyRecord.count()).resolves.toBe(0);
      await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(0);

      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    }
  });

  it("succeeds exactly once after the trigger is removed and the same key is retried", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    await expect(runPartialPayment(fixture, 2_000n)).rejects.toThrow();
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");

    const result = await runPartialPayment(fixture, 2_000n);
    expect(result.replayed).toBe(false);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
  });
});
