import type { PrismaClient } from "@prisma/client";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { refundOrder, returnOrderItems } from "@/lib/services/order-service";
import { PERMS } from "@/lib/api/permissions";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
} from "./idempotency-test-database";

export {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
};

export const IDEMPOTENCY_TEST_KEY_C = "770e8400-e29b-41d4-a716-446655440002";

/**
 * Closed, fully paid order ready for refund/return. Uses ISSUE_REFUNDS permission.
 */
export async function seedClosedPaidOrderFixture(
  client: PrismaClient,
  options: {
    grandTotal?: bigint;
    quantity?: number;
    productId?: number;
    orderId?: number;
    userId?: number;
    terminalId?: number;
    secondLineSameProduct?: boolean;
  } = {},
) {
  const grandTotal = options.grandTotal ?? 10_000n;
  const quantity = options.quantity ?? 5;
  const productId = options.productId ?? 10;
  const orderId = options.orderId ?? 500;
  const userId = options.userId ?? 2;
  const terminalId = options.terminalId ?? 1;
  const unitPrice = grandTotal / BigInt(quantity);

  await client.terminal.create({
    data: { id: terminalId, name: `Terminal ${terminalId}` },
  });
  await client.permission.create({
    data: { id: 10, name: PERMS.ISSUE_REFUNDS },
  });
  await client.role.create({ data: { id: 1, name: "Cashier" } });
  await client.rolePermission.create({
    data: { roleId: 1, permissionId: 10, accessLevel: 1 },
  });
  const user = await client.user.create({
    data: {
      id: userId,
      username: `cashier-${userId}`,
      fullName: "Cashier",
      passwordHash: "test-only-password-hash",
      roleId: 1,
    },
  });
  await client.paymentMethod.create({
    data: { id: 1, name: "Cash", code: "CASH" },
  });
  await client.productCategory.create({ data: { id: 1, name: "Grocery" } });
  const product = await client.product.create({
    data: {
      id: productId,
      name: "Test Product",
      categoryId: 1,
      basePrice: unitPrice,
      costPrice: 500n,
      currentStock: 100,
    },
  });
  const shift = await client.shift.create({
    data: {
      userId: user.id,
      terminalId,
      openingBalance: 10_000n,
    },
  });

  const lineItems = options.secondLineSameProduct
    ? [
        {
          productId: product.id,
          quantity: 3,
          unitPrice,
          lineTotal: unitPrice * 3n,
          status: "Closed" as const,
        },
        {
          productId: product.id,
          quantity: 2,
          unitPrice,
          lineTotal: unitPrice * 2n,
          status: "Closed" as const,
        },
      ]
    : [
        {
          productId: product.id,
          quantity,
          unitPrice,
          lineTotal: unitPrice * BigInt(quantity),
          status: "Closed" as const,
        },
      ];

  const order = await client.order.create({
    data: {
      id: orderId,
      orderNumber: `ORD-${orderId}`,
      orderType: "WalkIn",
      status: "Closed",
      cashierId: user.id,
      terminalId,
      shiftId: shift.id,
      subTotal: grandTotal,
      grandTotal,
      orderItems: { create: lineItems },
      payments: {
        create: {
          paymentMethodId: 1,
          amount: grandTotal,
          tenderedAmount: grandTotal,
          changeAmount: 0n,
          status: "Paid",
        },
      },
    },
    include: { orderItems: true },
  });

  return {
    user,
    product,
    shift,
    order,
    terminalId,
    grandTotal,
    orderItems: order.orderItems,
  };
}

export type ClosedPaidFixture = Awaited<
  ReturnType<typeof seedClosedPaidOrderFixture>
>;

export function runRefundIdempotent(
  client: PrismaClient,
  fixture: ClosedPaidFixture,
  options: {
    rawKey?: string;
    amount?: bigint;
    reason?: string;
  } = {},
) {
  const amount = options.amount ?? fixture.grandTotal;
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.refund",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      reason: options.reason ?? "customer request",
      amount,
      paymentMethodId: 1,
      terminalId: fixture.terminalId,
      referenceNo: null,
    },
    client,
    execute: async (tx) => {
      const result = await refundOrder(
        {
          orderId: fixture.order.id,
          reason: options.reason ?? "customer request",
          amount,
          paymentMethodId: 1,
          terminalId: fixture.terminalId,
          cashierId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}

export function runReturnIdempotent(
  client: PrismaClient,
  fixture: ClosedPaidFixture,
  options: {
    rawKey?: string;
    items: Array<{ orderItemId: number; returnQty: number; reason?: string }>;
    refundAmount: bigint;
  },
) {
  const items = options.items.map((item) => ({
    orderItemId: item.orderItemId,
    returnQty: item.returnQty,
    reason: item.reason ?? "damaged",
  }));
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.return",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      items: [...items].sort((a, b) => a.orderItemId - b.orderItemId),
      refundAmount: options.refundAmount,
    },
    client,
    execute: async (tx) => {
      const result = await returnOrderItems(
        {
          orderId: fixture.order.id,
          items,
          refundAmount: options.refundAmount,
          cashierId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}
