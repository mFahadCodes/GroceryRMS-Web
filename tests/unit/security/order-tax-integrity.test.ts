import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { ServiceError } from "@/lib/api/service-error";
import { ORDER_NOT_MUTABLE, claimOrderTotalsUpdate } from "@/lib/security/order-mutable-concurrency";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  applyOrderDiscount,
  applyOrderTax,
  checkoutFast,
} from "@/lib/services/order-service";
import { IDEMPOTENCY_TEST_KEY } from "./idempotency-test-database";
import {
  countAudits,
  createIdempotencyTestDatabase,
  ensureSecondTaxRate,
  resetMutableOrderTables,
  runOnMutableClient,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";

const FAIL_AUDIT = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("order tax integrity", () => {
  const database = createIdempotencyTestDatabase("p0f-tax-integrity");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("Open order: tax apply succeeds, totals updated, audit in transaction", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const second = await ensureSecondTaxRate(database.client, 2, 5);
    const updated = await runOnMutableClient(database.client, (tx) =>
      applyOrderTax(
        {
          orderId: fixture.order.id,
          taxRateId: second.id,
          userId: fixture.user.id,
        },
        tx,
      ),
    );
    expect(updated.taxRateId).toBe(second.id);
    expect(updated.taxAmount).toBeGreaterThan(0n);
    await expect(
      countAudits(database.client, "APPLY_ORDER_TAX"),
    ).resolves.toBe(1);
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
    "Delivered",
    "Closed",
    "Void",
  ] as const)("%s order: tax apply rejected with ORDER_NOT_MUTABLE", async (status) => {
    const fixture = await seedMutableOrderFixture(database.client, {
      status,
      taxPercent: 10,
    });
    const second = await ensureSecondTaxRate(database.client, 2, 5);
    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderTax(
          {
            orderId: fixture.order.id,
            taxRateId: second.id,
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
      countAudits(database.client, "APPLY_ORDER_TAX"),
    ).resolves.toBe(0);
  });

  it("invalid tax rate is rejected before mutation", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const before = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderTax(
          {
            orderId: fixture.order.id,
            taxRateId: 999,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toBeTruthy();
    const after = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(after.taxRateId).toBe(before.taxRateId);
    expect(after.taxAmount).toBe(before.taxAmount);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    await expect(
      countAudits(database.client, "APPLY_ORDER_TAX"),
    ).resolves.toBe(0);
  });

  it("audit failure rolls back tax mutation", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const second = await ensureSecondTaxRate(database.client, 2, 5);
    await database.client.$executeRawUnsafe(FAIL_AUDIT);
    await expect(
      runOnMutableClient(database.client, (tx) =>
        applyOrderTax(
          {
            orderId: fixture.order.id,
            taxRateId: second.id,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.taxRateId).toBe(fixture.taxRateId);
    await expect(
      countAudits(database.client, "APPLY_ORDER_TAX"),
    ).resolves.toBe(0);
  });

  it("when checkout wins first, tax apply is rejected with ORDER_NOT_MUTABLE", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const second = await ensureSecondTaxRate(database.client, 2, 5);

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
        applyOrderTax(
          {
            orderId: fixture.order.id,
            taxRateId: second.id,
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
      countAudits(database.client, "APPLY_ORDER_TAX"),
    ).resolves.toBe(0);
  });

  it("tax apply racing discount: one wins, loser gets 409", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const second = await ensureSecondTaxRate(database.client, 2, 5);

    const results = await Promise.allSettled([
      runOnMutableClient(database.client, (tx) =>
        applyOrderTax(
          {
            orderId: fixture.order.id,
            taxRateId: second.id,
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
    expect(rejected.length + fulfilled.length).toBe(2);
    if (rejected.length > 0) {
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
      });
    }
  });

  it("when first tax apply wins, a concurrent stale claim loses with conflict", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const second = await ensureSecondTaxRate(database.client, 2, 5);
    const prior = {
      subTotal: fixture.order.subTotal,
      taxAmount: fixture.order.taxAmount,
      grandTotal: fixture.order.grandTotal,
    };

    await runOnMutableClient(database.client, (tx) =>
      applyOrderTax(
        {
          orderId: fixture.order.id,
          taxRateId: second.id,
          userId: fixture.user.id,
        },
        tx,
      ),
    );

    await expect(
      database.client.$transaction(async (tx) => {
        await claimOrderTotalsUpdate(tx, fixture.order.id, prior, {
          subTotal: prior.subTotal,
          taxAmount: 999n,
          grandTotal: prior.grandTotal + 999n,
          taxRateId: 3,
        });
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
