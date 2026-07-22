import type { PrismaClient } from "@prisma/client";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { voidOrder } from "@/lib/services/order-service";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables as resetFinancialTables,
} from "./idempotency-test-database";
import {
  deterministicApprovalToken,
  insertGrant,
  seedManagerApprovalFixture,
  VOID_PERM,
} from "./manager-approval-test-database";

export {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  deterministicApprovalToken,
};

export async function resetIdempotencyTables(client: PrismaClient) {
  await resetFinancialTables(client);
  await client.managerApprovalGrant.deleteMany();
}

export const IDEMPOTENCY_TEST_KEY_C = "770e8400-e29b-41d4-a716-446655440002";

export async function seedVoidableOrderFixture(
  client: PrismaClient,
  options: {
    orderId?: number;
    reverseStockProduct?: boolean;
    quantity?: number;
    stock?: number;
    status?: "Open" | "PartiallyPaid" | "Closed";
    grandTotal?: bigint;
  } = {},
) {
  const orderId = options.orderId ?? 50;
  const quantity = options.quantity ?? 2;
  const stock = options.stock ?? 20;
  const status = options.status ?? "Open";
  const grandTotal = options.grandTotal ?? 10_000n;

  const fixture = await seedManagerApprovalFixture(client, {
    permissionName: VOID_PERM,
    managerAccessLevel: 5,
    requesterAccessLevel: 1,
    orderId,
  });
  fixture.requesterContext.permissions = [`${VOID_PERM}:1`];

  await client.order.update({
    where: { id: fixture.order.id },
    data: {
      status,
      subTotal: grandTotal,
      grandTotal,
    },
  });

  let product: { id: number; currentStock: unknown } | null = null;
  if (options.reverseStockProduct !== false) {
    await client.productCategory.create({
      data: { id: 1, name: "Grocery" },
    });
    product = await client.product.create({
      data: {
        id: 10,
        name: "Void Product",
        categoryId: 1,
        basePrice: grandTotal / BigInt(quantity),
        costPrice: 500n,
        currentStock: stock,
      },
    });
    await client.orderItem.create({
      data: {
        orderId: fixture.order.id,
        productId: product.id,
        quantity,
        unitPrice: grandTotal / BigInt(quantity),
        lineTotal: grandTotal,
        status: status === "Closed" ? "Closed" : "Open",
      },
    });
  }

  return { ...fixture, product, quantity, stock };
}

export async function issueVoidGrant(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedVoidableOrderFixture>>,
  tokenSeed: number,
) {
  const token = deterministicApprovalToken(tokenSeed);
  const grant = await insertGrant(client, {
    token,
    action: "order.void",
    resourceId: fixture.order.id,
    requesterUserId: fixture.requester.id,
    requesterSessionId: fixture.session.id,
    approverUserId: fixture.manager.id,
    requiredPermission: VOID_PERM,
    requiredAccessLevel: 5,
    terminalId: fixture.requesterContext.terminalId,
  });
  return { token, grant };
}

export async function runVoidIdempotent(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedVoidableOrderFixture>>,
  options: {
    rawKey?: string;
    token: string;
    reason?: string;
    reverseStock?: boolean;
  },
) {
  const reason = options.reason ?? "customer cancelled";
  const reverseStock = options.reverseStock ?? false;
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.void",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.requester.id,
    authoritativeTerminalId: fixture.requesterContext.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      reason,
      reverseStock,
    },
    client,
    execute: async (tx) => {
      const result = await voidOrder(
        {
          orderId: fixture.order.id,
          reason,
          reverseStock,
          approvalToken: options.token,
          requester: fixture.requesterContext,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}
