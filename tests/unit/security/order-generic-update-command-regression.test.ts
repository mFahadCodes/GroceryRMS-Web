import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));
vi.mock("@/lib/api/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

import { PUT } from "../../../app/api/orders/[id]/route";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

type Fixture = Awaited<ReturnType<typeof seedManagerApprovalFixture>>;

/**
 * Every magic note value the generic route previously interpreted as a
 * privileged command (verified against source and Git history):
 * - "hold"     → holdOrder() without the hold/recall permission
 * - "recall"   → recallOrder() without the hold/recall permission
 * - "void:..." → voidOrder() self-approved by the acting cashier
 * Case and whitespace variants matched because the handler lowercased and
 * trimmed the note before dispatching.
 */
const FORMER_COMMAND_NOTES = [
  "hold",
  "Hold",
  "HOLD",
  "  hold  ",
  "recall",
  "Recall",
  "RECALL",
  "  recall  ",
  "void: damaged goods",
  "VOID: damaged goods",
  "void:",
  "  void: trailing  ",
];

const PRIVILEGED_AUDIT_ACTIONS = [
  "HOLD_ORDER",
  "RECALL_ORDER",
  "VOID_ORDER",
  "APPLY_ORDER_DISCOUNT",
  "MANAGER_APPROVAL_CONSUMED",
];

function request(body: unknown) {
  return new NextRequest("http://localhost/api/orders/50", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "50" }) };

describe("former magic note commands have no authority", () => {
  const database = createManagerApprovalTestDatabase("sec04a-commands");
  let fixture: Fixture;

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetManagerApprovalTables(database.client);
    fixture = await seedManagerApprovalFixture(database.client);
    mocks.requirePermission.mockResolvedValue({
      session: {
        user: {
          id: fixture.requester.id,
          permissions: ["Create & process orders:1"],
        },
      },
    });
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it.each(FORMER_COMMAND_NOTES)(
    "stores %j as plain note text without privileged effects",
    async (note) => {
      const response = await PUT(
        request({ action: "updateMeta", notes: note }),
        context,
      );
      expect(response.status).toBe(200);

      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.notes).toBe(note);
      expect(order.status).toBe("Open");
      expect(order.voidReason).toBeNull();
      expect(order.discountAmount).toBe(0n);
      expect(order.adjustment).toBe(0n);
      expect(order.grandTotal).toBe(10_000n);
      expect(order.approvedByUserId).toBeNull();

      const privilegedAudits = await database.client.auditLog.count({
        where: { action: { in: PRIVILEGED_AUDIT_ACTIONS } },
      });
      expect(privilegedAudits).toBe(0);
      const metaAudits = await database.client.auditLog.count({
        where: { action: "UPDATE_ORDER_META" },
      });
      expect(metaAudits).toBe(1);
      await expect(
        database.client.managerApprovalGrant.count({
          where: { consumedAt: { not: null } },
        }),
      ).resolves.toBe(0);
    },
  );

  it("does not strip or append the legacy hold marker to note text", async () => {
    const note = "please keep aside [HELD]";
    const response = await PUT(
      request({ action: "updateMeta", notes: note }),
      context,
    );
    expect(response.status).toBe(200);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.notes).toBe(note);
  });

  it("keeps order items untouched when a former void command is submitted", async () => {
    await database.client.productCategory.create({
      data: { id: 1, name: "Dairy" },
    });
    await database.client.product.create({
      data: {
        id: 1,
        name: "Milk",
        basePrice: 5_000n,
        costPrice: 3_000n,
        categoryId: 1,
      },
    });
    await database.client.orderItem.create({
      data: {
        orderId: fixture.order.id,
        productId: 1,
        quantity: 2,
        unitPrice: 5_000n,
        lineTotal: 10_000n,
      },
    });

    const response = await PUT(
      request({ action: "updateMeta", notes: "void: everything" }),
      context,
    );
    expect(response.status).toBe(200);
    const items = await database.client.orderItem.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.status).not.toBe("Void");
    expect(items[0]!.voidReason).toBeNull();
    await expect(database.client.stockMovement.count()).resolves.toBe(0);
  });
});
