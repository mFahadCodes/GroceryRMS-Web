import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) throw new Error("Disposable Prisma client is not initialized");
    return prismaRef.client;
  },
}));

import {
  incrementPurchaseOrderLine,
  PURCHASE_ORDER_ITEM_CONFLICT,
} from "../../../lib/inventory/purchase-order-receive";
import { receivePurchaseOrder } from "../../../lib/services/inventory-service";
import {
  createPurchaseOrderReceiveTestDatabase,
  installFailureTrigger,
  resetPurchaseOrderReceiveTables,
  seedPurchaseOrderFixture,
} from "./purchase-order-receive-test-database";

async function expectPristine(
  client: import("@prisma/client").PrismaClient,
  purchaseOrderId: number,
  productIds: number[],
) {
  const [po, items, products, movements, audits] = await Promise.all([
    client.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } }),
    client.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      orderBy: { id: "asc" },
    }),
    client.product.findMany({
      where: { id: { in: productIds } },
      orderBy: { id: "asc" },
    }),
    client.stockMovement.count(),
    client.auditLog.count({ where: { action: "RECEIVE_PURCHASE_ORDER" } }),
  ]);
  expect(po.status).toBe("Draft");
  expect(po.receivedAt).toBeNull();
  expect(items.map((item) => item.quantityReceived.toString())).toEqual(
    items.map(() => "0"),
  );
  expect(products.map((product) => product.currentStock.toString())).toEqual(
    products.map(() => "0"),
  );
  expect(movements).toBe(0);
  expect(audits).toBe(0);
}

describe("purchase-order receive rollback", () => {
  const database = createPurchaseOrderReceiveTestDatabase("inv1-rollback");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetPurchaseOrderReceiveTables(database.client);
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("rolls back after the first line when the second line update fails", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await installFailureTrigger(database.client, {
      name: "fail_po_line_update",
      table: "purchase_order_items",
      timing: "UPDATE",
      when: `OLD.product_id = ${fixture.products[1]!.id}`,
    });
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
        { itemId: fixture.purchaseOrder.items[1]!.id, quantityReceived: 3 },
      ], fixture.user.id),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("rolls back when a product stock update fails", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await installFailureTrigger(database.client, {
      name: "fail_product_update",
      table: "products",
      timing: "UPDATE",
      when: `OLD.id = ${fixture.products[0]!.id}`,
    });
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], fixture.user.id),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("rolls back when stock-movement creation fails", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await installFailureTrigger(database.client, {
      name: "fail_stock_movement_insert",
      table: "stock_movements",
      timing: "INSERT",
    });
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], fixture.user.id),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("rolls back when required-audit creation fails", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await installFailureTrigger(database.client, {
      name: "fail_audit_insert",
      table: "audit_logs",
      timing: "INSERT",
    });
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], fixture.user.id),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("rolls back when the PO claim/final-state update fails", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await installFailureTrigger(database.client, {
      name: "fail_po_status_update",
      table: "purchase_orders",
      timing: "UPDATE",
    });
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], fixture.user.id),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("rolls back when audit actor persistence violates referential integrity", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], 999_999),
    ).rejects.toThrow();
    await expectPristine(database.client, fixture.purchaseOrder.id, [10, 11]);
  });

  it("line CAS rejects an exact-prior mismatch", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      productIds: [10],
      quantitiesReceived: [2],
    });
    await expect(
      database.client.$transaction((tx) =>
        incrementPurchaseOrderLine(tx, {
          purchaseOrderId: fixture.purchaseOrder.id,
          itemId: fixture.purchaseOrder.items[0]!.id,
          priorQuantity: new Prisma.Decimal(1),
          receivedQuantity: new Prisma.Decimal(1),
        }),
      ),
    ).rejects.toMatchObject({ code: PURCHASE_ORDER_ITEM_CONFLICT, status: 409 });
  });

  it("line CAS mismatch leaves the persisted quantity unchanged", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      productIds: [10],
      quantitiesReceived: [2],
    });
    await database.client.$transaction(async (tx) => {
      await expect(
        incrementPurchaseOrderLine(tx, {
          purchaseOrderId: fixture.purchaseOrder.id,
          itemId: fixture.purchaseOrder.items[0]!.id,
          priorQuantity: new Prisma.Decimal(1),
          receivedQuantity: new Prisma.Decimal(7),
        }),
      ).rejects.toThrow();
    }).catch(() => undefined);
    const item = await database.client.purchaseOrderItem.findUniqueOrThrow({
      where: { id: fixture.purchaseOrder.items[0]!.id },
    });
    expect(item.quantityReceived.toString()).toBe("2");
  });

  it("successful receipt commits all required effects together", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }],
      fixture.user.id,
    );
    const [po, item, product, movements, audits] = await Promise.all([
      database.client.purchaseOrder.findUniqueOrThrow({ where: { id: fixture.purchaseOrder.id } }),
      database.client.purchaseOrderItem.findUniqueOrThrow({ where: { id: fixture.purchaseOrder.items[0]!.id } }),
      database.client.product.findUniqueOrThrow({ where: { id: 10 } }),
      database.client.stockMovement.count(),
      database.client.auditLog.count({ where: { action: "RECEIVE_PURCHASE_ORDER" } }),
    ]);
    expect([po.status, item.quantityReceived.toString(), product.currentStock.toString(), movements, audits])
      .toEqual(["Received", "2", "2", 1, 1]);
  });
});
