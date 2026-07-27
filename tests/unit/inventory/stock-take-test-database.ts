import type { Prisma, PrismaClient, StockTakeStatus } from "@prisma/client";
import {
  createManagerApprovalTestDatabase,
  managerApprovalMigrationPaths,
} from "../security/manager-approval-test-database";

export {
  createManagerApprovalTestDatabase as createStockTakeTestDatabase,
  managerApprovalMigrationPaths,
};

export const STOCK_TAKE_TEST_KEY_A = "550e8400-e29b-41d4-a716-446655440000";
export const STOCK_TAKE_TEST_KEY_B = "660e8400-e29b-41d4-a716-446655440001";

export async function resetStockTakeTables(client: PrismaClient) {
  for (const trigger of [
    "fail_stock_take_update",
    "fail_stock_take_item_update",
    "fail_product_update",
    "fail_stock_movement_insert",
    "fail_audit_insert",
    "fail_idempotency_complete",
  ]) {
    await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  await client.idempotencyRecord.deleteMany();
  await client.stockMovement.deleteMany();
  await client.auditLog.deleteMany();
  await client.stockTakeItem.deleteMany();
  await client.stockTake.deleteMany();
  await client.productVariant.deleteMany();
  await client.product.deleteMany();
  await client.productCategory.deleteMany();
  await client.userSession.deleteMany();
  await client.user.deleteMany();
  await client.rolePermission.deleteMany();
  await client.permission.deleteMany();
  await client.role.deleteMany();
}

export async function seedStockTakeFixture(
  client: PrismaClient,
  options: {
    stockTakeId?: number;
    status?: StockTakeStatus;
    productIds?: number[];
    initialStocks?: Array<string | number>;
    userId?: number;
    notes?: string;
  } = {},
) {
  const stockTakeId = options.stockTakeId ?? 100;
  const productIds = options.productIds ?? [10, 11];
  const userId = options.userId ?? 2;

  await client.role.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Manager" },
  });

  const user = await client.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      username: `inventory-${userId}`,
      fullName: `Inventory Manager ${userId}`,
      passwordHash: "test-only-password-hash",
      roleId: 1,
    },
  });

  const category = await client.productCategory.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Test Category" },
  });

  const products = [];
  for (let index = 0; index < productIds.length; index += 1) {
    const id = productIds[index]!;
    const stock = options.initialStocks?.[index] ?? 10;
    products.push(
      await client.product.upsert({
        where: { id },
        update: {},
        create: {
          id,
          name: `Product ${id}`,
          sku: `SKU-${id}`,
          basePrice: 500n,
          costPrice: 300n,
          categoryId: category.id,
          currentStock: stock,
        },
      }),
    );
  }

  const stockTake = await client.stockTake.create({
    data: {
      id: stockTakeId,
      status: options.status ?? "InProgress",
      userId: user.id,
      notes: options.notes ?? "Test stock take",
      items: {
        create: products.map((product) => ({
          productId: product.id,
          expectedQty: product.currentStock,
          countedQty: product.currentStock,
        })),
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });

  return { user, category, products, stockTake };
}

export function buildApplyItems(
  stockTakeItems: Array<{ id: number; expectedQty: Prisma.Decimal | { toString(): string } }>,
  countedQuantities: Array<string | number>,
) {
  return stockTakeItems.map((item, index) => ({
    itemId: item.id,
    countedQty: countedQuantities[index] ?? item.expectedQty.toString(),
  }));
}

export async function installStockTakeFailureTrigger(
  client: PrismaClient,
  input: {
    name:
      | "fail_stock_take_update"
      | "fail_stock_take_item_update"
      | "fail_product_update"
      | "fail_stock_movement_insert"
      | "fail_audit_insert"
      | "fail_idempotency_complete";
    table:
      | "stock_takes"
      | "stock_take_items"
      | "products"
      | "stock_movements"
      | "audit_logs"
      | "idempotency_records";
    timing: "UPDATE" | "INSERT";
    when?: string;
  },
) {
  const when = input.when ? ` WHEN ${input.when}` : "";
  await client.$executeRawUnsafe(
    `CREATE TRIGGER ${input.name} BEFORE ${input.timing} ON ${input.table}${when} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
  );
}
