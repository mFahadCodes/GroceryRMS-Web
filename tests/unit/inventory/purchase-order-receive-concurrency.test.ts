import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../../../lib/api/service-error";

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
  PURCHASE_ORDER_NOT_RECEIVABLE,
} from "../../../lib/inventory/purchase-order-receive";
import { receivePurchaseOrder } from "../../../lib/services/inventory-service";
import {
  createPurchaseOrderReceiveTestDatabase,
  resetPurchaseOrderReceiveTables,
  seedPurchaseOrderFixture,
} from "./purchase-order-receive-test-database";

function conflicts(results: PromiseSettledResult<unknown>[]) {
  return results.filter(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof ServiceError &&
      result.reason.status === 409,
  );
}

describe("purchase-order receive concurrency", () => {
  const database = createPurchaseOrderReceiveTestDatabase("inv1-concurrency");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetPurchaseOrderReceiveTables(database.client);
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("allows at most one simultaneous receive for the same PO", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const itemId = fixture.purchaseOrder.items[0]!.id;
    const results = await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(conflicts(results)).toHaveLength(1);
  });

  it("maps the identical-payload loser to a safe 409", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const payload = [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 3 }];
    const results = await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, payload, fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, payload, fixture.user.id),
    ]);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.status).toBe("rejected");
    if (loser?.status === "rejected") {
      expect(loser.reason).toMatchObject({
        code: PURCHASE_ORDER_NOT_RECEIVABLE,
        status: 409,
      });
    }
  });

  it("maps a different-payload loser to a safe 409", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const itemId = fixture.purchaseOrder.items[0]!.id;
    const results = await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 4 }], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 7 }], fixture.user.id),
    ]);
    expect(conflicts(results)).toHaveLength(1);
  });

  it("does not duplicate stock under same-PO contention", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, {
      productIds: [10],
      initialStocks: [5],
    });
    const itemId = fixture.purchaseOrder.items[0]!.id;
    await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
    ]);
    const product = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
    expect(product.currentStock.toString()).toBe("7");
  });

  it("does not duplicate movements under same-PO contention", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const itemId = fixture.purchaseOrder.items[0]!.id;
    await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
    ]);
    await expect(database.client.stockMovement.count()).resolves.toBe(1);
  });

  it("does not duplicate required audits under same-PO contention", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const itemId = fixture.purchaseOrder.items[0]!.id;
    await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [{ itemId, quantityReceived: 2 }], fixture.user.id),
    ]);
    await expect(
      database.client.auditLog.count({ where: { action: "RECEIVE_PURCHASE_ORDER" } }),
    ).resolves.toBe(1);
  });

  it("does not leave partially updated lines under same-PO contention", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    const first = fixture.purchaseOrder.items[0]!.id;
    const second = fixture.purchaseOrder.items[1]!.id;
    await Promise.allSettled([
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: first, quantityReceived: 2 },
        { itemId: second, quantityReceived: 3 },
      ], fixture.user.id),
      receivePurchaseOrder(fixture.purchaseOrder.id, [
        { itemId: first, quantityReceived: 7 },
        { itemId: second, quantityReceived: 8 },
      ], fixture.user.id),
    ]);
    const rows = await database.client.purchaseOrderItem.findMany({
      where: { purchaseOrderId: fixture.purchaseOrder.id },
      orderBy: { id: "asc" },
    });
    expect([
      rows.map((row) => row.quantityReceived.toString()),
    ]).toSatisfy(
      ([quantities]) =>
        JSON.stringify(quantities) === JSON.stringify(["2", "3"]) ||
        JSON.stringify(quantities) === JSON.stringify(["7", "8"]),
    );
  });

  it("rejects a sequential repeat without another business effect", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client, { productIds: [10] });
    const payload = [{ itemId: fixture.purchaseOrder.items[0]!.id, quantityReceived: 2 }];
    await receivePurchaseOrder(fixture.purchaseOrder.id, payload, fixture.user.id);
    await expect(
      receivePurchaseOrder(fixture.purchaseOrder.id, payload, fixture.user.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(database.client.stockMovement.count()).resolves.toBe(1);
  });
});
