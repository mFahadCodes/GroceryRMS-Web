import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { ServiceError } from "@/lib/api/service-error";
import { ORDER_NOT_MUTABLE } from "@/lib/security/order-mutable-concurrency";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  applyOrderAdjustment,
  applyOrderDiscount,
  checkoutFast,
} from "@/lib/services/order-service";
import { IDEMPOTENCY_TEST_KEY } from "./idempotency-test-database";
import {
  countAudits,
  createIdempotencyTestDatabase,
  resetMutableOrderTables,
  runOnMutableClient,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";

const FAIL_AUDIT = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("order adjustment integrity", () => {
  const database = createIdempotencyTestDatabase("p0f-adjustment-integrity");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("Open order: adjustment succeeds with CAS", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const updated = await runOnMutableClient(database.client, (tx) =>
      applyOrderAdjustment(
        {
          orderId: fixture.order.id,
          adjustment: -500n,
          userId: fixture.user.id,
        },
        tx,
      ),
    );
    expect(updated.adjustment).toBe(-500n);
    expect(updated.grandTotal).toBe(fixture.lineTotal - 500n);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(1);
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
    "Delivered",
    "Closed",
    "Void",
  ] as const)("non-Open %s: adjustment rejected", async (status) => {
    const fixture = await seedMutableOrderFixture(database.client, { status });
    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderAdjustment(
          {
            orderId: fixture.order.id,
            adjustment: 100n,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(0);
  });

  it("when checkout wins first, adjustment is rejected with ORDER_NOT_MUTABLE", async () => {
    const fixture = await seedMutableOrderFixture(database.client);

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: fixture.lineTotal,
        terminalId: fixture.terminalId,
        discountPercent: 0,
        taxPercent: 0,
        customerId: null,
        notes: null,
        referenceNo: null,
        redeemPoints: 0n,
        payments: null,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            tenderedAmount: fixture.lineTotal,
            terminalId: fixture.terminalId,
            cashierId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderAdjustment(
          {
            orderId: fixture.order.id,
            adjustment: -200n,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(0);
  });

  it("adjustment racing discount: loser gets 409", async () => {
    const fixture = await seedMutableOrderFixture(database.client);

    const results = await Promise.allSettled([
      runOnMutableClient(database.client, (tx) =>
        applyOrderAdjustment(
          {
            orderId: fixture.order.id,
            adjustment: -200n,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
      runOnMutableClient(database.client, (tx) =>
        applyOrderDiscount(
          {
            orderId: fixture.order.id,
            discountAmount: 250n,
            approvedByUserId: fixture.user.id,
          },
          tx,
        ),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length + rejected.length).toBe(2);
    if (rejected.length > 0) {
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
      });
    }
  });

  it("rollback: no partial mutation on audit failure", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT);
    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderAdjustment(
          {
            orderId: fixture.order.id,
            adjustment: -300n,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.adjustment).toBe(0n);
    expect(order.grandTotal).toBe(fixture.lineTotal);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(0);
  });
});
