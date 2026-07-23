import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { PERMS } from "@/lib/api/permissions";
import { ORDER_NOT_DISCOUNTABLE } from "@/lib/security/discount-concurrency";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { checkoutFast } from "@/lib/services/order-service";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";

describe("discount versus checkout races", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-checkout");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function attachCashShift(
    fixture: Awaited<ReturnType<typeof seedDiscountableOrderFixture>>,
  ) {
    await database.client.permission.create({
      data: { id: 2, name: PERMS.PROCESS_PAYMENTS },
    });
    await database.client.permission.create({
      data: { id: 3, name: PERMS.CREATE_ORDERS },
    });
    await database.client.rolePermission.create({
      data: { roleId: 1, permissionId: 2, accessLevel: 1 },
    });
    await database.client.rolePermission.create({
      data: { roleId: 1, permissionId: 3, accessLevel: 1 },
    });
    await database.client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const shift = await database.client.shift.create({
      data: {
        userId: fixture.requester.id,
        terminalId: fixture.requesterContext.terminalId!,
        openingBalance: 10_000n,
      },
    });
    await database.client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: shift.id },
    });
  }

  it("when checkout wins first, discount loses and leaves grant unconsumed", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await attachCashShift(fixture);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 40);

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: fixture.lineTotal,
        terminalId: fixture.requesterContext.terminalId,
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
            terminalId: fixture.requesterContext.terminalId!,
            cashierId: fixture.requester.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    await expect(
      runDiscountIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
        discountAmount: 500n,
      }),
    ).rejects.toMatchObject({ code: ORDER_NOT_DISCOUNTABLE, status: 409 });

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    expect(order.discountAmount).toBe(0n);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });

  it("when discount wins first, checkout closes using the discounted totals", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await attachCashShift(fixture);
    const { token } = await issueDiscountGrant(database.client, fixture, 41);

    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token,
      discountAmount: 1_000n,
    });
    const discounted = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(discounted.discountAmount).toBe(1_000n);
    expect(discounted.status).toBe("Open");

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: discounted.grandTotal,
        terminalId: fixture.requesterContext.terminalId,
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
            tenderedAmount: discounted.grandTotal,
            terminalId: fixture.requesterContext.terminalId!,
            cashierId: fixture.requester.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    const closed = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(closed.status).toBe("Closed");
    expect(closed.discountAmount).toBe(1_000n);
    expect(closed.grandTotal).toBe(discounted.grandTotal);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(2);
  });
});
