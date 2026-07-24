import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  PURCHASE_ORDER_DUPLICATE_ITEM,
  PURCHASE_ORDER_ITEM_NOT_FOUND,
} from "../../../lib/inventory/purchase-order-receive";
import { receivePurchaseOrder } from "../../../lib/services/inventory-service";
import {
  createPurchaseOrderReceiveTestDatabase,
  resetPurchaseOrderReceiveTables,
  seedPurchaseOrderFixture,
} from "./purchase-order-receive-test-database";

describe("purchase-order receive contract", () => {
  const database = createPurchaseOrderReceiveTestDatabase("inv1-contract");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetPurchaseOrderReceiveTables(database.client);
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("preserves selected-line one-shot receiving", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    const selected = fixture.purchaseOrder.items[0]!;
    const result = await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: selected.id, quantityReceived: 4 }],
      fixture.user.id,
    );
    expect(result.status).toBe("Received");
    expect(result.items.find((item) => item.id === selected.id)?.quantityReceived.toString()).toBe("4");
    expect(result.items.find((item) => item.id !== selected.id)?.quantityReceived.toString()).toBe("0");
  });

  it("increments from the authoritative prior line quantity", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      quantitiesReceived: [1.5, 0],
    });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: "2.25" }],
      fixture.user.id,
    );
    const item = await database.client.purchaseOrderItem.findUniqueOrThrow({
      where: { id: fixture.purchaseOrder.items[0]!.id },
    });
    expect(item.quantityReceived.toString()).toBe("3.75");
  });

  it("rejects duplicate item IDs before any mutation", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    const itemId = fixture.purchaseOrder.items[0]!.id;
    await expect(
      receivePurchaseOrder(
        fixture.purchaseOrder.id,
        [
          { itemId, quantityReceived: 1 },
          { itemId, quantityReceived: 2 },
        ],
        fixture.user.id,
      ),
    ).rejects.toMatchObject({ code: PURCHASE_ORDER_DUPLICATE_ITEM, status: 400 });
    await expect(database.client.stockMovement.count()).resolves.toBe(0);
  });

  it("rejects an item from another purchase order", async () => {
    const first = await seedPurchaseOrderFixture(database.client, {
      purchaseOrderId: 100,
      productIds: [10],
    });
    const second = await seedPurchaseOrderFixture(database.client, {
      purchaseOrderId: 101,
      productIds: [11],
      userId: first.user.id,
    });
    await expect(
      receivePurchaseOrder(
        first.purchaseOrder.id,
        [{ itemId: second.purchaseOrder.items[0]!.id, quantityReceived: 1 }],
        first.user.id,
      ),
    ).rejects.toMatchObject({ code: PURCHASE_ORDER_ITEM_NOT_FOUND, status: 404 });
  });

  it("returns supplier and line data from inside the transaction", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    const result = await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 1 }],
      fixture.user.id,
    );
    expect(result.supplier.id).toBe(fixture.supplier.id);
    expect(result.items).toHaveLength(2);
  });

  it("does not change supplier balance", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 1 }],
      fixture.user.id,
    );
    const supplier = await database.client.supplier.findUniqueOrThrow({
      where: { id: fixture.supplier.id },
    });
    expect(supplier.balance).toBe(1234n);
  });

  it("does not change product cost price", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 1 }],
      fixture.user.id,
    );
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.products[0]!.id },
    });
    expect(product.costPrice).toBe(300n);
  });

  it("preserves decimal quantities in line and movement records", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: "1.125" }],
      fixture.user.id,
    );
    const [item, movement] = await Promise.all([
      database.client.purchaseOrderItem.findUniqueOrThrow({
        where: { id: fixture.purchaseOrder.items[0]!.id },
      }),
      database.client.stockMovement.findFirstOrThrow(),
    ]);
    expect(item.quantityReceived.toString()).toBe("1.125");
    expect(movement.quantity.toString()).toBe("1.125");
  });
});
