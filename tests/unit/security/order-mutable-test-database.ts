import type { Prisma, PrismaClient } from "@prisma/client";
import { PERMS } from "@/lib/api/permissions";
import {
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
  countAudits,
} from "./idempotency-test-database";

export { createIdempotencyTestDatabase, countAudits };

export async function resetMutableOrderTables(client: PrismaClient) {
  await resetIdempotencyTables(client);
  await client.taxRate.deleteMany();
}

/** Run a mutable-surface service against the fixture client (not root prisma). */
export function runOnMutableClient<T>(
  client: PrismaClient,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(execute);
}

export type MutableOrderStatus =
  | "Open"
  | "PartiallyPaid"
  | "Packed"
  | "OutForDelivery"
  | "Delivered"
  | "Closed"
  | "Void";

/**
 * Seeds an Open-capable order with a product, actor, optional tax rate, and
 * line item. Uses command-scoped `.tmp/<name>.test.db` via createIdempotencyTestDatabase.
 */
export async function seedMutableOrderFixture(
  client: PrismaClient,
  options: {
    orderId?: number;
    productId?: number;
    userId?: number;
    terminalId?: number;
    quantity?: number;
    unitPrice?: bigint;
    stock?: number;
    status?: MutableOrderStatus;
    taxRateId?: number | null;
    taxPercent?: number;
    discountAmount?: bigint;
    taxAmount?: bigint;
    adjustment?: bigint;
    grandTotal?: bigint;
  } = {},
) {
  const orderId = options.orderId ?? 80;
  const productId = options.productId ?? 10;
  const userId = options.userId ?? 2;
  const terminalId = options.terminalId ?? 1;
  const quantity = options.quantity ?? 2;
  const unitPrice = options.unitPrice ?? 5_000n;
  const stock = options.stock ?? 20;
  const status = options.status ?? "Open";
  const lineTotal = unitPrice * BigInt(quantity);
  const discountAmount = options.discountAmount ?? 0n;
  const taxAmount = options.taxAmount ?? 0n;
  const adjustment = options.adjustment ?? 0n;
  const grandTotal =
    options.grandTotal ?? lineTotal - discountAmount + taxAmount + adjustment;

  await client.terminal.create({
    data: { id: terminalId, name: `Terminal ${terminalId}` },
  });

  await client.permission.createMany({
    data: [
      { id: 1, name: PERMS.CREATE_ORDERS },
      { id: 2, name: PERMS.MANAGE_TAX_DISCOUNTS },
      { id: 3, name: PERMS.PROCESS_PAYMENTS },
      { id: 4, name: PERMS.APPLY_DISCOUNTS },
    ],
  });
  await client.role.create({ data: { id: 1, name: "Cashier" } });
  await client.rolePermission.createMany({
    data: [
      { roleId: 1, permissionId: 1, accessLevel: 1 },
      { roleId: 1, permissionId: 2, accessLevel: 1 },
      { roleId: 1, permissionId: 3, accessLevel: 1 },
      { roleId: 1, permissionId: 4, accessLevel: 4 },
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
      name: "Mutable Product",
      categoryId: 1,
      basePrice: unitPrice,
      costPrice: 500n,
      currentStock: stock,
      maxDiscount: 0,
    },
  });

  let taxRateId = options.taxRateId ?? null;
  if (options.taxPercent !== undefined || taxRateId !== null) {
    const rate = await client.taxRate.create({
      data: {
        id: taxRateId ?? 1,
        name: "GST",
        rate: options.taxPercent ?? 10,
        isInclusive: false,
        isActive: true,
      },
    });
    taxRateId = rate.id;
  }

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
      status,
      cashierId: user.id,
      terminalId,
      shiftId: shift.id,
      taxRateId,
      subTotal: lineTotal,
      discountAmount,
      taxAmount,
      adjustment,
      grandTotal,
      orderItems: {
        create: {
          productId: product.id,
          quantity,
          unitPrice,
          lineTotal,
          status: status === "Void" ? "Void" : "Open",
        },
      },
    },
    include: { orderItems: true },
  });

  return {
    user,
    product,
    order,
    shift,
    terminalId,
    quantity,
    unitPrice,
    lineTotal,
    taxRateId,
  };
}

export async function ensureSecondTaxRate(
  client: PrismaClient,
  id = 2,
  percent = 5,
) {
  return client.taxRate.create({
    data: {
      id,
      name: `Tax ${id}`,
      rate: percent,
      isInclusive: false,
      isActive: true,
    },
  });
}
