import type { PrismaClient } from "@prisma/client";
import { PERMS } from "@/lib/api/permissions";
import {
  createManagerApprovalTestDatabase,
  managerApprovalMigrationPaths,
} from "./manager-approval-test-database";

export {
  createManagerApprovalTestDatabase as createIdempotencyTestDatabase,
  managerApprovalMigrationPaths as idempotencyMigrationPaths,
};

export const IDEMPOTENCY_TEST_KEY = "550e8400-e29b-41d4-a716-446655440000";
export const IDEMPOTENCY_TEST_KEY_B = "660e8400-e29b-41d4-a716-446655440001";

export async function resetIdempotencyTables(client: PrismaClient) {
  await client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
  await client.idempotencyRecord.deleteMany();
  await client.cashDrawerLog.deleteMany();
  await client.stockMovement.deleteMany();
  await client.loyaltyTransaction.deleteMany();
  await client.syncQueue.deleteMany();
  await client.payment.deleteMany();
  await client.auditLog.deleteMany();
  await client.orderItem.deleteMany();
  await client.order.deleteMany();
  await client.shift.deleteMany();
  await client.product.deleteMany();
  await client.productCategory.deleteMany();
  await client.userSession.deleteMany();
  await client.user.deleteMany();
  await client.rolePermission.deleteMany();
  await client.permission.deleteMany();
  await client.role.deleteMany();
  await client.paymentMethod.deleteMany();
  await client.terminal.deleteMany();
  await client.appSetting.deleteMany();
  await client.pinThrottleState.deleteMany();
}

/**
 * Seeds an actor (role + permissions + user), a terminal, an open shift, a
 * Cash payment method, an in-stock product, and an Open order with a single
 * line item — everything `checkoutFast` needs to run for real inside a test
 * transaction. Uses no FK relation to `idempotencyRecord` (there is none by
 * design), so these fixtures are reusable across every idempotency test file.
 */
export async function seedCheckoutOrderFixture(
  client: PrismaClient,
  options: {
    userId?: number;
    terminalId?: number | null;
    orderId?: number;
    productId?: number;
    unitPrice?: bigint;
    quantity?: number;
    stock?: number;
    authoritativeTerminalId?: number | null;
  } = {},
) {
  const userId = options.userId ?? 2;
  const terminalId = options.terminalId === undefined ? 1 : options.terminalId;
  const orderId = options.orderId ?? 100;
  const productId = options.productId ?? 10;
  const unitPrice = options.unitPrice ?? 1_000n;
  const quantity = options.quantity ?? 2;
  const stock = options.stock ?? 20;
  const lineTotal = unitPrice * BigInt(quantity);

  if (terminalId !== null) {
    await client.terminal.create({
      data: { id: terminalId, name: `Terminal ${terminalId}` },
    });
  }

  await client.permission.createMany({
    data: [
      { id: 1, name: PERMS.PROCESS_PAYMENTS },
      { id: 2, name: PERMS.CREATE_ORDERS },
    ],
  });
  await client.role.create({ data: { id: 1, name: "Cashier" } });
  await client.rolePermission.createMany({
    data: [
      { roleId: 1, permissionId: 1, accessLevel: 1 },
      { roleId: 1, permissionId: 2, accessLevel: 1 },
    ],
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

  await client.productCategory.create({
    data: { id: 1, name: "Grocery" },
  });

  const product = await client.product.create({
    data: {
      id: productId,
      name: "Test Product",
      categoryId: 1,
      basePrice: unitPrice,
      costPrice: 500n,
      currentStock: stock,
    },
  });

  const shift = await client.shift.create({
    data: {
      userId: user.id,
      terminalId,
      openingBalance: 10_000n,
    },
  });

  const order = await client.order.create({
    data: {
      id: orderId,
      orderNumber: `ORD-${orderId}`,
      orderType: "WalkIn",
      status: "Open",
      cashierId: user.id,
      terminalId,
      subTotal: lineTotal,
      grandTotal: lineTotal,
      orderItems: {
        create: {
          productId: product.id,
          quantity,
          unitPrice,
          lineTotal,
          status: "Open",
        },
      },
    },
    include: { orderItems: true },
  });

  return {
    user,
    terminalId,
    product,
    shift,
    order,
    unitPrice,
    quantity,
    lineTotal,
    grandTotal: lineTotal,
    authoritativeTerminalId:
      options.authoritativeTerminalId === undefined
        ? terminalId
        : options.authoritativeTerminalId,
  };
}

/**
 * Same actor/shift/product setup as `seedCheckoutOrderFixture`, but sized for
 * `applyPartialPayment`, which reads `order.grandTotal` directly instead of
 * recomputing totals. `grandTotal` drives both the single line item price
 * and the order's stored total so the two stay consistent.
 */
export async function seedPartialPaymentOrderFixture(
  client: PrismaClient,
  options: {
    grandTotal?: bigint;
    shiftAttached?: boolean;
    userId?: number;
    terminalId?: number | null;
    orderId?: number;
  } = {},
) {
  const grandTotal = options.grandTotal ?? 5_000n;
  const fixture = await seedCheckoutOrderFixture(client, {
    userId: options.userId,
    terminalId: options.terminalId,
    orderId: options.orderId,
    unitPrice: grandTotal,
    quantity: 1,
  });

  if (options.shiftAttached !== false) {
    await client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: fixture.shift.id },
    });
  }

  return fixture;
}

export async function countPayments(
  client: PrismaClient,
  orderId: number,
): Promise<number> {
  return client.payment.count({ where: { orderId } });
}

export async function countStockMovements(
  client: PrismaClient,
  productId: number,
  type?: "Purchase" | "Consumption" | "Waste" | "Adjustment" | "Sale" | "Return",
): Promise<number> {
  return client.stockMovement.count({
    where: { productId, ...(type ? { type } : {}) },
  });
}

export async function countAudits(
  client: PrismaClient,
  action?: string,
): Promise<number> {
  return client.auditLog.count({ where: action ? { action } : {} });
}

export async function countIdempotencyRecords(
  client: PrismaClient,
): Promise<number> {
  return client.idempotencyRecord.count();
}

export async function getIdempotencyRecordByScope(
  client: PrismaClient,
  scopeHash: string,
) {
  return client.idempotencyRecord.findUnique({ where: { scopeHash } });
}
