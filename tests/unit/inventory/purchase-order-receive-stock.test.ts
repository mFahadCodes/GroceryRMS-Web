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

import { receivePurchaseOrder } from "../../../lib/services/inventory-service";
import {
  createPurchaseOrderReceiveTestDatabase,
  resetPurchaseOrderReceiveTables,
  seedPurchaseOrderFixture,
} from "./purchase-order-receive-test-database";

describe("purchase-order receive stock effects", () => {
  const database = createPurchaseOrderReceiveTestDatabase("inv1-stock");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetPurchaseOrderReceiveTables(database.client);
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("atomically increments product stock", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      productIds: [10],
      initialStocks: ["1.5"],
    });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: "2.25" }],
      fixture.user.id,
    );
    const product = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
    expect(product.currentStock.toString()).toBe("3.75");
  });

  it("increments each selected product independently", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      initialStocks: [4, 9],
    });
    await receivePurchaseOrder(fixture.purchaseOrder.id, [
      { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      { itemId: fixture.purchaseOrder.items[1]!.id, quantityReceived: 3 },
    ], fixture.user.id);
    const products = await database.client.product.findMany({ orderBy: { id: "asc" } });
    expect(products.map((product) => product.currentStock.toString())).toEqual(["6", "12"]);
  });

  it("creates one movement per received line", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    await receivePurchaseOrder(fixture.purchaseOrder.id, [
      { itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      { itemId: fixture.purchaseOrder.items[1]!.id, quantityReceived: 3 },
    ], fixture.user.id);
    await expect(database.client.stockMovement.count()).resolves.toBe(2);
  });

  it("uses Purchase movement type and PO reference", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }],
      fixture.user.id,
    );
    const movement = await database.client.stockMovement.findFirstOrThrow();
    expect(movement.type).toBe("Purchase");
    expect(movement.reference).toBe(`PO-${fixture.purchaseOrder.id}`);
  });

  it("preserves movement costAmount as the PO line unit cost", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }],
      fixture.user.id,
    );
    const movement = await database.client.stockMovement.findFirstOrThrow();
    expect(movement.costAmount).toBe(fixture.purchaseOrder.items[0]!.unitCost);
  });

  it("attributes movements to the receiving actor", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }],
      fixture.user.id,
    );
    const movement = await database.client.stockMovement.findFirstOrThrow();
    expect(movement.userId).toBe(fixture.user.id);
  });

  it("leaves variant records unchanged because PO lines target products", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      productIds: [10],
      withVariant: true,
    });
    const before = await database.client.productVariant.findUniqueOrThrow({
      where: { id: fixture.variant!.id },
    });
    await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }],
      fixture.user.id,
    );
    const after = await database.client.productVariant.findUniqueOrThrow({
      where: { id: fixture.variant!.id },
    });
    expect(after).toEqual(before);
  });

  it("composes independent PO increments on one shared product", async () => {
    const first = await seedPurchaseOrderFixture(database.client, {
      purchaseOrderId: 100,
      productIds: [10],
      initialStocks: [5],
    });
    const second = await seedPurchaseOrderFixture(database.client, {
      purchaseOrderId: 101,
      productIds: [10],
      userId: first.user.id,
    });
    const results = await Promise.allSettled([
      receivePurchaseOrder(first.purchaseOrder.id, [
        { itemId: first.purchaseOrder.items[0]!.id, quantityReceived: 2 },
      ], first.user.id),
      receivePurchaseOrder(second.purchaseOrder.id, [
        { itemId: second.purchaseOrder.items[0]!.id, quantityReceived: 3 },
      ], second.user.id),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const product = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
    expect(product.currentStock.toString()).toBe("10");
  });
});
