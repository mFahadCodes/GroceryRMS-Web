import type {
  PrismaClient,
  PurchaseOrderStatus,
} from "@prisma/client";
import {
  createManagerApprovalTestDatabase,
  managerApprovalMigrationPaths,
} from "../security/manager-approval-test-database";

export {
  createManagerApprovalTestDatabase as createPurchaseOrderReceiveTestDatabase,
  managerApprovalMigrationPaths,
};

export async function resetPurchaseOrderReceiveTables(client: PrismaClient) {
  for (const trigger of [
    "fail_po_line_update",
    "fail_product_update",
    "fail_stock_movement_insert",
    "fail_audit_insert",
    "fail_po_status_update",
  ]) {
    await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  await client.stockMovement.deleteMany();
  await client.auditLog.deleteMany();
  await client.purchaseOrderItem.deleteMany();
  await client.purchaseOrder.deleteMany();
  await client.productVariant.deleteMany();
  await client.product.deleteMany();
  await client.productCategory.deleteMany();
  await client.supplier.deleteMany();
  await client.userSession.deleteMany();
  await client.user.deleteMany();
  await client.rolePermission.deleteMany();
  await client.permission.deleteMany();
  await client.role.deleteMany();
  await client.pinThrottleState.deleteMany();
}

export async function seedPurchaseOrderFixture(
  client: PrismaClient,
  options: {
    purchaseOrderId?: number;
    status?: PurchaseOrderStatus;
    isActive?: boolean;
    productIds?: number[];
    quantitiesOrdered?: Array<string | number>;
    quantitiesReceived?: Array<string | number>;
    initialStocks?: Array<string | number>;
    withVariant?: boolean;
    userId?: number;
  } = {},
) {
  const purchaseOrderId = options.purchaseOrderId ?? 100;
  const productIds = options.productIds ?? [10, 11];
  const userId = options.userId ?? 2;

  await client.role.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Inventory manager" },
  });
  const user = await client.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      username: `inventory-${userId}`,
      fullName: `Inventory User ${userId}`,
      passwordHash: "test-only-password-hash",
      roleId: 1,
    },
  });
  const category = await client.productCategory.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Test category" },
  });
  const supplier = await client.supplier.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Test supplier", balance: 1234n },
  });

  const products = [];
  for (let index = 0; index < productIds.length; index += 1) {
    const id = productIds[index]!;
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
          supplierId: supplier.id,
          currentStock: options.initialStocks?.[index] ?? 0,
        },
      }),
    );
  }

  const variant =
    options.withVariant && products[0]
      ? await client.productVariant.create({
          data: {
            productId: products[0].id,
            name: "Reference variant",
            priceOverride: 550n,
            sku: `VAR-${products[0].id}`,
          },
        })
      : null;

  const purchaseOrder = await client.purchaseOrder.create({
    data: {
      id: purchaseOrderId,
      supplierId: supplier.id,
      status: options.status ?? "Draft",
      isActive: options.isActive ?? true,
      orderedAt: new Date("2026-07-24T00:00:00.000Z"),
      totalAmount: 10_000n,
      items: {
        create: productIds.map((productId, index) => ({
          productId,
          quantityOrdered: options.quantitiesOrdered?.[index] ?? 10,
          quantityReceived: options.quantitiesReceived?.[index] ?? 0,
          unitCost: BigInt(200 + index),
        })),
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });

  return { user, category, supplier, products, variant, purchaseOrder };
}

export function receiveItems(
  fixture: Awaited<ReturnType<typeof seedPurchaseOrderFixture>>,
  quantities: Array<string | number> = [2, 3],
) {
  return fixture.purchaseOrder.items.map((item, index) => ({
    itemId: item.id,
    quantityReceived: quantities[index] ?? 1,
  }));
}

export async function installFailureTrigger(
  client: PrismaClient,
  input: {
    name:
      | "fail_po_line_update"
      | "fail_product_update"
      | "fail_stock_movement_insert"
      | "fail_audit_insert"
      | "fail_po_status_update";
    table:
      | "purchase_order_items"
      | "products"
      | "stock_movements"
      | "audit_logs"
      | "purchase_orders";
    timing: "UPDATE" | "INSERT";
    when?: string;
  },
) {
  const when = input.when ? ` WHEN ${input.when}` : "";
  await client.$executeRawUnsafe(
    `CREATE TRIGGER ${input.name} BEFORE ${input.timing} ON ${input.table}${when} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
  );
}
