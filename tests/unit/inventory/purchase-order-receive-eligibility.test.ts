import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrderStatus } from "@prisma/client";

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
  assertPurchaseOrderReceivable,
  isReceivablePurchaseOrderStatus,
  PURCHASE_ORDER_NOT_FOUND,
  PURCHASE_ORDER_NOT_RECEIVABLE,
  RECEIVABLE_PURCHASE_ORDER_STATUSES,
} from "../../../lib/inventory/purchase-order-receive";
import { ServiceError } from "../../../lib/api/service-error";
import { receivePurchaseOrder } from "../../../lib/services/inventory-service";
import {
  createPurchaseOrderReceiveTestDatabase,
  receiveItems,
  resetPurchaseOrderReceiveTables,
  seedPurchaseOrderFixture,
} from "./purchase-order-receive-test-database";

describe("purchase-order receive eligibility", () => {
  const database = createPurchaseOrderReceiveTestDatabase("inv1-eligibility");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetPurchaseOrderReceiveTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("defines Draft as the exact receive-entry allowlist", () => {
    expect(RECEIVABLE_PURCHASE_ORDER_STATUSES).toEqual(["Draft"]);
  });

  it.each([
    ["Draft", true],
    ["Ordered", false],
    ["PartialReceived", false],
    ["Received", false],
    ["Cancelled", false],
  ] as Array<[PurchaseOrderStatus, boolean]>)(
    "classifies %s eligibility as %s",
    (status, expected) => {
      expect(isReceivablePurchaseOrderStatus(status)).toBe(expected);
    },
  );

  it("rejects an inactive Draft purchase order", () => {
    expect(() =>
      assertPurchaseOrderReceivable({ status: "Draft", isActive: false }),
    ).toThrowError(
      expect.objectContaining({
        code: PURCHASE_ORDER_NOT_RECEIVABLE,
        status: 409,
      }),
    );
  });

  it("receives an active Draft purchase order", async () => {
    const fixture = await seedPurchaseOrderFixture(database.client);
    const result = await receivePurchaseOrder(
      fixture.purchaseOrder.id,
      receiveItems(fixture),
      fixture.user.id,
    );
    expect(result.status).toBe("Received");
    expect(result.receivedAt).not.toBeNull();
  });

  it.each(["Ordered", "PartialReceived", "Received", "Cancelled"] as const)(
    "rejects persisted %s without inventory effects",
    async (status) => {
      const fixture = await seedPurchaseOrderFixture(database.client, { status });
      await expect(
        receivePurchaseOrder(
          fixture.purchaseOrder.id,
          receiveItems(fixture),
          fixture.user.id,
        ),
      ).rejects.toMatchObject({
        code: PURCHASE_ORDER_NOT_RECEIVABLE,
        status: 409,
      } satisfies Partial<ServiceError>);
      await expect(database.client.stockMovement.count()).resolves.toBe(0);
    },
  );

  it("maps a missing purchase order to the established 404 code", async () => {
    await expect(
      receivePurchaseOrder(999_999, [{ itemId: 1, quantityReceived: 1 }], 2),
    ).rejects.toMatchObject({
      code: PURCHASE_ORDER_NOT_FOUND,
      status: 404,
    } satisfies Partial<ServiceError>);
  });
});
