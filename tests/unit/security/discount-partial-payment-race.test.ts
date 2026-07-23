import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { ORDER_NOT_DISCOUNTABLE } from "@/lib/security/discount-concurrency";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { applyPartialPayment } from "@/lib/services/order-service";
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

describe("discount versus partial-payment races", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-partial");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function seedPayable() {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await database.client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const shift = await database.client.shift.create({
      data: {
        userId: fixture.requester.id,
        terminalId: fixture.requesterContext.terminalId!,
        openingBalance: 5_000n,
      },
    });
    await database.client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: shift.id },
    });
    return fixture;
  }

  it("when partial payment wins first, discount loses and grant stays unconsumed", async () => {
    const fixture = await seedPayable();
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 50);

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 4_000n,
        referenceNo: null,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 4_000n,
            userId: fixture.requester.id,
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
    expect(order.status).toBe("PartiallyPaid");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });

  it("losing discount after partial payment leaves no completed discount idempotency row", async () => {
    const fixture = await seedPayable();
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 51);

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 4_000n,
        referenceNo: null,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 4_000n,
            userId: fixture.requester.id,
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

    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(
      database.client.idempotencyRecord.count({
        where: { operation: "order.discount" },
      }),
    ).resolves.toBe(0);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });

  it("when discount wins first, partial payment uses the discounted grand total", async () => {
    const fixture = await seedPayable();
    const { token } = await issueDiscountGrant(database.client, fixture, 51);
    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token,
      discountAmount: 2_000n,
    });
    const discounted = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 1_000n,
        referenceNo: null,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 1_000n,
            userId: fixture.requester.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    expect(order.discountAmount).toBe(2_000n);
    expect(order.grandTotal).toBe(discounted.grandTotal);
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(2);
  });
});
