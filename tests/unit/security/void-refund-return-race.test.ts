import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { refundOrder, returnOrderItems } from "@/lib/services/order-service";
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
    // Refund path needs ISSUE_REFUNDS — add permission for cashier role.
    const perm = await client.permission.create({
      data: { id: 99, name: "Issue refunds" },
    });
    await client.rolePermission.create({
      data: { roleId: 1, permissionId: perm.id, accessLevel: 1 },
    });
    return fixture;
  }

  it("void versus refund: at most one commits incompatible terminal stock/money effects", async () => {
    const fixture = await seedClosedPaid(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 60);
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });

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

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const returnMoves = await countStockMovements(
      database.client,
      fixture.product!.id,
      "Return",
    );
    // Winner may void-with-stock or refund-restore — never both for the same race outcome.
    if (order.status === "Void") {
      expect(returnMoves).toBe(1);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
      await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(0);
    } else {
      expect(order.status).toBe("Closed");
      expect(returnMoves).toBeGreaterThanOrEqual(1);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
      await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(1);
    }
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    void item;
  });

  it("void versus return: P0-C1 counters unchanged when void wins without return", async () => {
    const fixture = await seedClosedPaid(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 61);
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });

    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
      }),
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY_B,
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
              items: [
                { orderItemId: item.id, returnQty: 1, reason: "damaged" },
              ],
              refundAmount: 2_000n,
              cashierId: fixture.requester.id,
            },
            tx,
          );
          return { status: 200, body: serializeRecord(result) };
        },
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    if (order.status === "Void") {
      expect(source.returnedQuantity).toBe(0);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    } else {
      expect(source.returnedQuantity).toBe(1);
      await expect(countAudits(database.client, "RETURN")).resolves.toBe(1);
    }
  });

  it("sequential refund then void: void still allowed under current Closed→Void eligibility", async () => {
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
    const { token } = await issueVoidGrant(database.client, fixture, 62);
    await runVoidIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      token,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
  });
});
