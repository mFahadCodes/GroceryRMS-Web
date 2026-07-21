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
import { updateOrderMetadata } from "../../../lib/services/order-service";
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

describe("safe metadata updates preserve business invariants", () => {
  const database = createManagerApprovalTestDatabase("sec04a-invariants");
  let fixture: Fixture;

  beforeEach(async () => {
    prismaRef.client = database.client;
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_meta_audit",
    );
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

  it("does not change any financial or state field", async () => {
    const before = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const response = await PUT(
      request({ action: "updateMeta", notes: "gift wrap" }),
      context,
    );
    expect(response.status).toBe(200);
    const after = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(after.subTotal).toBe(before.subTotal);
    expect(after.taxAmount).toBe(before.taxAmount);
    expect(after.discountAmount).toBe(before.discountAmount);
    expect(after.serviceCharge).toBe(before.serviceCharge);
    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.adjustment).toBe(before.adjustment);
    expect(after.status).toBe(before.status);
    expect(after.approvedByUserId).toBe(before.approvedByUserId);
    expect(after.voidReason).toBe(before.voidReason);
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
    expect(after.shiftId).toBe(before.shiftId);
    expect(after.terminalId).toBe(before.terminalId);
    expect(after.cashierId).toBe(before.cashierId);
    expect(after.deliveredAt).toBe(before.deliveredAt);
  });

  it("creates no payments, items, stock movements, or loyalty rows", async () => {
    const response = await PUT(
      request({ action: "updateMeta", notes: "no side effects" }),
      context,
    );
    expect(response.status).toBe(200);
    await expect(database.client.payment.count()).resolves.toBe(0);
    await expect(database.client.orderItem.count()).resolves.toBe(0);
    await expect(database.client.stockMovement.count()).resolves.toBe(0);
    await expect(database.client.loyaltyTransaction.count()).resolves.toBe(0);
  });

  it("does not consume or create manager approval grants", async () => {
    const token = deterministicApprovalToken(81);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    const response = await PUT(
      request({ action: "updateMeta", notes: "note only" }),
      context,
    );
    expect(response.status).toBe(200);
    await expect(
      database.client.managerApprovalGrant.count(),
    ).resolves.toBe(1);
    await expect(
      database.client.managerApprovalGrant.count({
        where: { consumedAt: { not: null } },
      }),
    ).resolves.toBe(0);
  });

  it("produces exactly one intended audit event on success", async () => {
    const response = await PUT(
      request({ action: "updateMeta", notes: "audited note" }),
      context,
    );
    expect(response.status).toBe(200);
    const audits = await database.client.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("UPDATE_ORDER_META");
    expect(audits[0]!.tableName).toBe("orders");
    expect(audits[0]!.recordId).toBe(fixture.order.id);
    expect(audits[0]!.userId).toBe(fixture.requester.id);
  });

  it("writes no success audit and no mutation for a rejected privileged payload", async () => {
    const response = await PUT(
      request({ action: "updateMeta", notes: "n", discountAmount: 9_000 }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(database.client.auditLog.count()).resolves.toBe(0);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.notes).toBeNull();
    expect(order.discountAmount).toBe(0n);
  });

  it("writes no success audit when the metadata mutation itself fails", async () => {
    const response = await PUT(
      request({ action: "updateMeta", customerId: 424242 }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(
      database.client.auditLog.count({
        where: { action: "UPDATE_ORDER_META" },
      }),
    ).resolves.toBe(0);
  });

  it("keeps the metadata update non-blocking when audit logging fails (current contract)", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_meta_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'UPDATE_ORDER_META' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      const response = await PUT(
        request({ action: "updateMeta", notes: "audit down" }),
        context,
      );
      // auditLog() intentionally never blocks business flow; the metadata
      // write persists and the request still succeeds.
      expect(response.status).toBe(200);
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.notes).toBe("audit down");
      await expect(database.client.auditLog.count()).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_meta_audit",
      );
    }
  });

  it("rejects an empty metadata input at the service boundary as well", async () => {
    await expect(
      updateOrderMetadata(fixture.order.id, {}),
    ).rejects.toThrow("No metadata fields provided");
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.notes).toBeNull();
  });

  it("service metadata update writes only the provided allowlisted fields", async () => {
    const updated = await updateOrderMetadata(fixture.order.id, {
      notes: "service-level note",
    });
    expect(updated.notes).toBe("service-level note");
    expect(updated.customerId).toBeNull();
    expect(updated.status).toBe("Open");
    expect(updated.grandTotal).toBe(10_000n);
  });
});
