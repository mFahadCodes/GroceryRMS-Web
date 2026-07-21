import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_REDACTED,
  serializeSafeAuditMetadata,
} from "../../../lib/security/audit-sanitizer";
import {
  buildManagerApprovalAuditMetadata,
  buildOrderDiscountAuditMetadata,
  buildOrderVoidAuditMetadata,
  buildPasswordChangedAuditMetadata,
  buildPinChangedAuditMetadata,
  buildSessionForceLogoutAuditMetadata,
} from "../../../lib/security/audit-metadata";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));

import { auditLog, writeAuditRecord } from "../../../lib/audit";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit write boundary", () => {
  const database = createManagerApprovalTestDatabase("sec05a-write");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetManagerApprovalTables(database.client);
    await seedManagerApprovalFixture(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("persists safe metadata and redacts sensitive keys before Prisma", async () => {
    await writeAuditRecord(database.client, {
      userId: 2,
      action: "UPDATE_USER",
      tableName: "users",
      recordId: 2,
      newValues: {
        username: "cashier",
        password: "SuperSecret1!",
        pin: "4826",
        managerApprovalToken: "A".repeat(43),
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow();
    expect(row.newValues).toContain(AUDIT_REDACTED);
    expect(row.newValues).toContain("cashier");
    expect(row.newValues).not.toContain("SuperSecret1!");
    expect(row.newValues).not.toContain("4826");
    expect(row.newValues).not.toContain("A".repeat(43));
  });

  it("has no bypass flag and treats all caller metadata as untrusted", async () => {
    await auditLog({
      userId: 2,
      action: "TEST_AUDIT",
      newValues: {
        alreadySanitized: true,
        skipSanitize: true,
        authorization: "Bearer x.y.z",
        note: "ok",
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "TEST_AUDIT" },
    });
    expect(row.newValues).toContain(AUDIT_REDACTED);
    expect(row.newValues).toContain('"alreadySanitized":true');
    expect(row.newValues).not.toContain("Bearer");
  });

  it("keeps top-level audit fields intact", async () => {
    await writeAuditRecord(database.client, {
      userId: 2,
      action: "SAFE_EVENT",
      tableName: "orders",
      recordId: 50,
      oldValues: { status: "Open" },
      newValues: { status: "Closed" },
      ipAddress: "203.0.113.10",
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SAFE_EVENT" },
    });
    expect(row.userId).toBe(2);
    expect(row.tableName).toBe("orders");
    expect(row.recordId).toBe(50);
    expect(row.ipAddress).toBe("203.0.113.10");
    expect(row.oldValues).toContain("Open");
    expect(row.newValues).toContain("Closed");
  });

  it("supports transaction-client audit creation", async () => {
    await database.client.$transaction(async (tx) => {
      await writeAuditRecord(tx, {
        userId: 2,
        action: "TX_AUDIT",
        newValues: { ok: true },
      });
    });
    await expect(
      database.client.auditLog.count({ where: { action: "TX_AUDIT" } }),
    ).resolves.toBe(1);
  });

  it("security event builders accept only safe fields", () => {
    expect(buildPasswordChangedAuditMetadata()).toEqual({
      success: true,
      reauthenticationRequired: true,
    });
    expect(buildPinChangedAuditMetadata("administrator-changed")).toEqual({
      reason: "administrator-changed",
    });
    expect(
      buildManagerApprovalAuditMetadata({
        approverUserId: 7,
        action: "order.discount",
        resourceType: "order",
        status: "issued",
      }),
    ).toEqual({
      approverUserId: 7,
      action: "order.discount",
      resourceType: "order",
      status: "issued",
    });
    expect(
      buildSessionForceLogoutAuditMetadata({
        userId: 2,
        username: "cashier",
      }),
    ).toEqual({ userId: 2, username: "cashier" });
    expect(
      buildOrderVoidAuditMetadata({
        reason: "damaged",
        approvedByUserId: 7,
      }),
    ).toEqual({ reason: "damaged", approvedByUserId: 7 });
    expect(
      buildOrderDiscountAuditMetadata({
        discountAmount: 500n,
        discountPercent: 5,
        reason: null,
        approvedByUserId: 7,
      }),
    ).toEqual({
      discountAmount: "500",
      discountPercent: 5,
      reason: null,
      approvedByUserId: 7,
    });

    for (const payload of [
      buildPasswordChangedAuditMetadata(),
      buildPinChangedAuditMetadata("x"),
      buildManagerApprovalAuditMetadata({
        approverUserId: 1,
        action: "order.void",
        resourceType: "order",
        status: "consumed",
      }),
    ]) {
      const json = serializeSafeAuditMetadata(payload)!;
      expect(json).not.toMatch(/password|pin|token|sessionId/i);
    }
  });
});
