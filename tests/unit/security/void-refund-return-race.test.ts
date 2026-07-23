import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { ServiceError } from "@/lib/api/service-error";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { refundOrder, returnOrderItems } from "@/lib/services/order-service";
import { ORDER_NOT_VOIDABLE } from "@/lib/security/void-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
  countStockMovements,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
} from "./idempotency-test-database";
import {
  issueVoidGrant,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void versus refund/return races", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-refund-return");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function seedClosedPaid(client: typeof database.client) {
    const fixture = await seedVoidableOrderFixture(client, {
      status: "Closed",
      grandTotal: 10_000n,
      quantity: 5,
      stock: 50,
    });
    await client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const shift = await client.shift.create({
      data: {
        userId: fixture.requester.id,
        terminalId: fixture.requesterContext.terminalId!,
        openingBalance: 10_000n,
      },
    });
    await client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: shift.id, cashierId: fixture.requester.id },
    });
    await client.payment.create({
      data: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 10_000n,
        tenderedAmount: 10_000n,
        changeAmount: 0n,
        status: "Paid",
      },
    });
    const perm = await client.permission.create({
      data: { id: 99, name: "Issue refunds" },
    });
    await client.rolePermission.create({
      data: { roleId: 1, permissionId: perm.id, accessLevel: 1 },
    });
    return fixture;
  }

  it("refund commits first; void loses with Closed parent and unconsumed grant", async () => {
    const fixture = await seedClosedPaid(database.client);
    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.refund",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        reason: "partial",
        amount: 2_000n,
        paymentMethodId: 1,
        terminalId: fixture.requesterContext.terminalId,
        referenceNo: null,
      },
      client: database.client,
      execute: async (tx) => {
        const result = await refundOrder(
          {
            orderId: fixture.order.id,
            reason: "partial",
            amount: 2_000n,
            paymentMethodId: 1,
            terminalId: fixture.requesterContext.terminalId!,
            cashierId: fixture.requester.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });

    const { token, grant } = await issueVoidGrant(database.client, fixture, 60);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token,
        reverseStock: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === ORDER_NOT_VOIDABLE &&
        error.status === 409,
    );

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
    await expect(
      countStockMovements(database.client, fixture.product!.id, "Return"),
    ).resolves.toBeGreaterThanOrEqual(1);
  });

  it("return commits first; void loses and P0-C1 returnedQuantity stays", async () => {
    const fixture = await seedClosedPaid(database.client);
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.return",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        items: [{ orderItemId: item.id, returnQty: 1 }],
        refundAmount: 2_000n,
      },
      client: database.client,
      execute: async (tx) => {
        const result = await returnOrderItems(
          {
            orderId: fixture.order.id,
            items: [{ orderItemId: item.id, returnQty: 1, reason: "damaged" }],
            refundAmount: 2_000n,
            cashierId: fixture.requester.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });

    const { token, grant } = await issueVoidGrant(database.client, fixture, 61);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError && error.code === ORDER_NOT_VOIDABLE,
    );

    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(1);
    expect(source.sourceOrderItemId).toBeNull();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
  });

  it("void commits first on Open; refund/return reject non-Closed parent", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "Open",
      grandTotal: 10_000n,
      quantity: 5,
      stock: 50,
    });
    await database.client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 62);
    await runVoidIdempotent(database.client, fixture, { token });

    await expect(
      refundOrder({
        orderId: fixture.order.id,
        reason: "refund",
        paymentMethodId: 1,
        terminalId: fixture.requesterContext.terminalId!,
        cashierId: fixture.requester.id,
      }),
    ).rejects.toBeTruthy();

    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    await expect(
      returnOrderItems({
        orderId: fixture.order.id,
        items: [{ orderItemId: item.id, returnQty: 1, reason: "damaged" }],
        refundAmount: 2_000n,
        cashierId: fixture.requester.id,
      }),
    ).rejects.toBeTruthy();

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
    await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(0);
    await expect(countAudits(database.client, "RETURN")).resolves.toBe(0);
  });

  it("concurrent void against Closed never voids; refund may still win alone", async () => {
    const fixture = await seedClosedPaid(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 63);
    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
        reverseStock: true,
      }),
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        operation: "order.refund",
        resourceType: "orders",
        resourceId: fixture.order.id,
        actorUserId: fixture.requester.id,
        authoritativeTerminalId: fixture.requesterContext.terminalId,
        requestPayload: {
          orderId: fixture.order.id,
          reason: "refund",
          amount: null,
          paymentMethodId: 1,
          terminalId: fixture.requesterContext.terminalId,
          referenceNo: null,
        },
        client: database.client,
        execute: async (tx) => {
          const result = await refundOrder(
            {
              orderId: fixture.order.id,
              reason: "refund",
              paymentMethodId: 1,
              terminalId: fixture.requesterContext.terminalId!,
              cashierId: fixture.requester.id,
            },
            tx,
          );
          return { status: 200, body: serializeRecord(result) };
        },
      }),
    ]);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    expect(results.some((r) => r.status === "rejected")).toBe(true);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
    await expect(countIdempotencyRecords(database.client)).resolves.toBeLessThanOrEqual(1);
  });
});
