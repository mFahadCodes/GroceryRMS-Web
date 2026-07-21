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
  deterministicApprovalToken,
  insertGrant,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

type Fixture = Awaited<ReturnType<typeof seedManagerApprovalFixture>>;

function request(body: unknown) {
  return new NextRequest("http://localhost/api/orders/50", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "50" }) };

async function orderSnapshot(orderId: number) {
  return prismaRef.client!.order.findUniqueOrThrow({
    where: { id: orderId },
  });
}

describe("generic order update privilege escalation boundary", () => {
  const database = createManagerApprovalTestDatabase("sec04a-escalation");
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

  it("allows a level-1 user to perform an approved safe metadata update", async () => {
    const before = await orderSnapshot(fixture.order.id);
    const response = await PUT(
      request({ action: "updateMeta", notes: "call on arrival" }),
      context,
    );
    expect(response.status).toBe(200);
    const after = await orderSnapshot(fixture.order.id);
    expect(after.notes).toBe("call on arrival");
    expect(after.status).toBe(before.status);
    expect(after.subTotal).toBe(before.subTotal);
    expect(after.taxAmount).toBe(before.taxAmount);
    expect(after.discountAmount).toBe(before.discountAmount);
    expect(after.serviceCharge).toBe(before.serviceCharge);
    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.adjustment).toBe(before.adjustment);
    expect(after.approvedByUserId).toBe(before.approvedByUserId);
    expect(after.cashierId).toBe(before.cashierId);
  });

  it.each([
    ["percentage discount", { discountPercent: 50 }],
    ["fixed discount", { discountAmount: 5000 }],
    ["generic discount", { discount: 5000 }],
    ["adjustment", { adjustment: -9000 }],
    ["tax change", { taxPercent: 0 }],
    ["tax amount", { taxAmount: 0 }],
    ["void", { status: "Void" }],
    ["cancel", { cancelled: true }],
    ["close", { status: "Closed" }],
    ["dispatch", { status: "OutForDelivery" }],
    ["delivered", { delivered: true }],
    ["delivered timestamp", { deliveredAt: "2026-07-21T00:00:00.000Z" }],
    ["hold", { hold: true }],
    ["recall", { recall: true }],
    ["checkout", { checkout: true }],
    ["payment", { payments: [{ paymentMethodId: 1, amount: 10_000 }] }],
    ["payment status", { paymentStatus: "Paid" }],
    ["refund state", { refunded: true }],
    ["return state", { returned: true }],
    ["subtotal", { subTotal: 1 }],
    ["total", { grandTotal: 1 }],
    ["balance", { balance: 0 }],
    ["item mutation", { items: [{ productId: 1, quantity: 99 }] }],
    ["stock mutation", { stock: [{ productId: 1, quantity: -5 }] }],
    ["manager PIN", { managerPin: "4826" }],
    ["manager identity", { managerUserId: 7 }],
    ["approver override", { approvedByUserId: 7 }],
    ["ownership change", { cashierId: 7, userId: 7 }],
    ["shift/terminal rebinding", { shiftId: 99, terminalId: 99 }],
    ["auth version", { authVersion: 99 }],
  ])(
    "prevents level-1 escalation via %s and leaves the order untouched",
    async (_label, extra) => {
      const before = await orderSnapshot(fixture.order.id);
      const response = await PUT(
        request({ action: "updateMeta", notes: "n", ...extra }),
        context,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      const after = await orderSnapshot(fixture.order.id);
      expect(after).toEqual(before);
      await expect(
        prismaRef.client!.auditLog.count(),
      ).resolves.toBe(0);
      await expect(prismaRef.client!.payment.count()).resolves.toBe(0);
      await expect(prismaRef.client!.stockMovement.count()).resolves.toBe(0);
    },
  );

  it("rejects a manager approval token submitted in the generic body", async () => {
    const token = deterministicApprovalToken(71);
    const grant = await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    const response = await PUT(
      request({
        action: "updateMeta",
        notes: "apply my discount",
        managerApprovalToken: token,
      }),
      context,
    );
    expect(response.status).toBe(400);
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow(
      { where: { id: grant.id } },
    );
    expect(stored.consumedAt).toBeNull();
    const after = await orderSnapshot(fixture.order.id);
    expect(after.discountAmount).toBe(0n);
    expect(after.status).toBe("Open");
  });

  it("cannot consume a discount grant through the generic route", async () => {
    const token = deterministicApprovalToken(72);
    const grant = await insertGrant(database.client, {
      token,
      action: "order.discount",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    // The raw token as note text has no authority; it is stored as plain text.
    const response = await PUT(
      request({ action: "updateMeta", notes: token }),
      context,
    );
    expect(response.status).toBe(200);
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow(
      { where: { id: grant.id } },
    );
    expect(stored.consumedAt).toBeNull();
    const after = await orderSnapshot(fixture.order.id);
    expect(after.notes).toBe(token);
    expect(after.discountAmount).toBe(0n);
  });

  it("cannot consume a void grant through the generic route", async () => {
    const token = deterministicApprovalToken(73);
    const grant = await insertGrant(database.client, {
      token,
      action: "order.void",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      requiredPermission: "Void / cancel orders",
      requiredAccessLevel: 5,
    });
    const response = await PUT(
      request({ action: "updateMeta", notes: `void: ${token}` }),
      context,
    );
    expect(response.status).toBe(200);
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow(
      { where: { id: grant.id } },
    );
    expect(stored.consumedAt).toBeNull();
    const after = await orderSnapshot(fixture.order.id);
    expect(after.status).toBe("Open");
    expect(after.voidReason).toBeNull();
  });

  it("cannot use a grant to alter unrelated metadata authority", async () => {
    const token = deterministicApprovalToken(74);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    const response = await PUT(
      request({
        action: "updateMeta",
        customerId: 424242,
        managerApprovalToken: token,
      }),
      context,
    );
    expect(response.status).toBe(400);
    const after = await orderSnapshot(fixture.order.id);
    expect(after.customerId).toBeNull();
  });

  it("keeps safe customer reassignment within referential integrity", async () => {
    await database.client.customer.create({
      data: { id: 9, name: "Walk-in customer", phone: "03001234567" },
    });
    const response = await PUT(
      request({ action: "updateMeta", customerId: 9 }),
      context,
    );
    expect(response.status).toBe(200);
    const after = await orderSnapshot(fixture.order.id);
    expect(after.customerId).toBe(9);
    expect(after.grandTotal).toBe(10_000n);

    const missing = await PUT(
      request({ action: "updateMeta", customerId: 424242 }),
      context,
    );
    expect(missing.status).toBe(400);
    const unchanged = await orderSnapshot(fixture.order.id);
    expect(unchanged.customerId).toBe(9);
  });

  it("rejects an empty generic payload", async () => {
    const response = await PUT(request({ action: "updateMeta" }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
