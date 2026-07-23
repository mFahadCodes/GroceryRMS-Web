import type { PrismaClient } from "@prisma/client";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { applyOrderDiscount } from "@/lib/services/order-service";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables as resetFinancialTables,
} from "./idempotency-test-database";
import {
  deterministicApprovalToken,
  DISCOUNT_PERM,
  insertGrant,
  installManagerApprovalTestClock,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

export {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  deterministicApprovalToken,
};

export const IDEMPOTENCY_TEST_KEY_C = "770e8400-e29b-41d4-a716-446655440002";

installManagerApprovalTestClock();

export async function resetIdempotencyTables(client: PrismaClient) {
  await resetFinancialTables(client);
  await client.managerApprovalGrant.deleteMany();
}

export async function seedDiscountableOrderFixture(
  client: PrismaClient,
  options: {
    orderId?: number;
    quantity?: number;
    unitPrice?: bigint;
    stock?: number;
    status?:
      | "Open"
      | "PartiallyPaid"
      | "Packed"
      | "OutForDelivery"
      | "Delivered"
      | "Closed"
      | "Void";
    discountAmount?: bigint;
    taxAmount?: bigint;
    grandTotal?: bigint;
  } = {},
) {
  const orderId = options.orderId ?? 50;
  const quantity = options.quantity ?? 2;
  const unitPrice = options.unitPrice ?? 5_000n;
  const stock = options.stock ?? 20;
  const status = options.status ?? "Open";
  const lineTotal = unitPrice * BigInt(quantity);
  const discountAmount = options.discountAmount ?? 0n;
  const taxAmount = options.taxAmount ?? 0n;
  const grandTotal = options.grandTotal ?? lineTotal - discountAmount + taxAmount;

  const fixture = await seedManagerApprovalFixture(client, {
    permissionName: DISCOUNT_PERM,
    managerAccessLevel: 4,
    requesterAccessLevel: 1,
    orderId,
  });
  fixture.requesterContext.permissions = [`${DISCOUNT_PERM}:1`];

  await client.productCategory.create({
    data: { id: 1, name: "Grocery" },
  });
  const product = await client.product.create({
    data: {
      id: 10,
      name: "Discount Product",
      categoryId: 1,
      basePrice: unitPrice,
      costPrice: 500n,
      currentStock: stock,
      maxDiscount: 0,
    },
  });
  await client.orderItem.create({
    data: {
      orderId: fixture.order.id,
      productId: product.id,
      quantity,
      unitPrice,
      lineTotal,
      status: status === "Void" ? "Void" : "Open",
    },
  });
  await client.order.update({
    where: { id: fixture.order.id },
    data: {
      status,
      subTotal: lineTotal,
      discountAmount,
      taxAmount,
      grandTotal,
    },
  });

  const order = await client.order.findUniqueOrThrow({
    where: { id: fixture.order.id },
  });

  return { ...fixture, order, product, quantity, unitPrice, lineTotal };
}

export async function issueDiscountGrant(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedDiscountableOrderFixture>>,
  tokenSeed: number,
) {
  const token = deterministicApprovalToken(tokenSeed);
  const grant = await insertGrant(client, {
    token,
    action: "order.discount",
    resourceId: fixture.order.id,
    requesterUserId: fixture.requester.id,
    requesterSessionId: fixture.session.id,
    approverUserId: fixture.manager.id,
    requiredPermission: DISCOUNT_PERM,
    requiredAccessLevel: 4,
    terminalId: fixture.requesterContext.terminalId,
  });
  return { token, grant };
}

export async function runDiscountIdempotent(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedDiscountableOrderFixture>>,
  options: {
    rawKey?: string;
    token: string;
    discountAmount?: bigint;
    discountPercent?: number;
    reason?: string | null;
  },
) {
  const discountAmount = options.discountAmount;
  const discountPercent = options.discountPercent;
  const reason = options.reason ?? "manager courtesy";
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.discount",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.requester.id,
    authoritativeTerminalId: fixture.requesterContext.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      discountAmount: discountAmount ?? null,
      discountPercent: discountPercent ?? null,
      reason,
    },
    client,
    execute: async (tx) => {
      const result = await applyOrderDiscount(
        {
          orderId: fixture.order.id,
          discountAmount,
          discountPercent,
          reason,
          approvalToken: options.token,
          requester: fixture.requesterContext,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}
