import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import { checkoutFast } from "@/lib/services/order-service";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { serializeRecord } from "@/lib/api/serialize";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";
import {
  isFinancialConflict,
  runCheckoutIdempotent,
  runPartialIdempotent,
} from "./financial-concurrency-harness";

const FAIL_AUDIT_TRIGGER = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("financial concurrency rollback", () => {
  const database = createIdempotencyTestDatabase("p0b-concurrency-rollback");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("checkout audit failure rolls back close, payment, stock, and idempotency", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(
        runCheckoutIdempotent(database.client, fixture),
      ).rejects.toThrow();
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
      await expect(
        countPayments(database.client, fixture.order.id),
      ).resolves.toBe(0);
      await expect(
        countStockMovements(database.client, fixture.product.id, "Sale"),
      ).resolves.toBe(0);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
      await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("after checkout audit rollback, a different key can succeed", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(
        runCheckoutIdempotent(database.client, fixture, {
          rawKey: IDEMPOTENCY_TEST_KEY,
        }),
      ).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }

    await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("partial payment audit failure rolls back payment and status", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 8_000n,
    });
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(
        runPartialIdempotent(database.client, fixture, {
          amount: 3_000n,
        }),
      ).rejects.toThrow();
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
      await expect(
        countPayments(database.client, fixture.order.id),
      ).resolves.toBe(0);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("CAS conflict on already-closed order creates no payment", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await expect(
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        operation: "order.checkout",
        resourceType: "orders",
        resourceId: fixture.order.id,
        actorUserId: fixture.user.id,
        authoritativeTerminalId: fixture.terminalId,
        requestPayload: { orderId: fixture.order.id, retry: true },
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
      }),
    ).rejects.toSatisfy(isFinancialConflict);

    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("payment exceeding remaining rolls back idempotency reservation", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await expect(
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 5_001n,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(0);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
  });

  it("second partial after full payment conflicts without adding a payment", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 5_000n,
    });
    await expect(
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 100n,
      }),
    ).rejects.toSatisfy(isFinancialConflict);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });
});
