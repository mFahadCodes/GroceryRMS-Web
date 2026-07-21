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

import {
  writeBestEffortAudit,
  writeRequiredAudit,
} from "../../../lib/audit";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit write boundary", () => {
  const database = createManagerApprovalTestDatabase("sec05b-write");

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
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "UPDATE_USER",
        recordId: 2,
        newValues: {
          username: "cashier",
          fieldsChanged: ["username"],
          passwordChanged: false,
          pinChanged: false,
        },
      });
    });
    await writeBestEffortAudit({
      userId: 2,
      action: "CREATE_ORDER",
      recordId: 50,
      newValues: {
        username: "cashier",
        password: "SuperSecret1!",
        pin: "4826",
        managerApprovalToken: "A".repeat(43),
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CREATE_ORDER" },
    });
    expect(row.newValues).toContain(AUDIT_REDACTED);
    expect(row.newValues).not.toContain("SuperSecret1!");
    expect(row.newValues).not.toContain("4826");
    expect(row.newValues).not.toContain("A".repeat(43));
  });

  it("has no bypass flag and treats all caller metadata as untrusted", async () => {
    await writeBestEffortAudit({
      userId: 2,
      action: "UPDATE_ORDER_META",
      recordId: 50,
      newValues: {
        alreadySanitized: true,
        skipSanitize: true,
        authorization: "Bearer x.y.z",
        notesProvided: true,
        customerId: null,
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "UPDATE_ORDER_META" },
    });
    expect(row.newValues).toContain(AUDIT_REDACTED);
    expect(row.newValues).toContain('"alreadySanitized":true');
    expect(row.newValues).not.toContain("Bearer");
  });

  it("keeps top-level audit fields intact and uses registry entity table", async () => {
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "CHECKOUT",
        recordId: 50,
        newValues: {
          terminalId: 1,
          paymentCount: 1,
          paymentMethodIds: [1],
          grandTotal: "1000",
        },
        ipAddress: "203.0.113.10",
      });
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CHECKOUT" },
    });
    expect(row.userId).toBe(2);
    expect(row.tableName).toBe("orders");
    expect(row.recordId).toBe(50);
    expect(row.ipAddress).toBe("203.0.113.10");
    expect(row.newValues).toContain("1000");
  });

  it("supports transaction-client required audit creation", async () => {
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "PASSWORD_CHANGED",
        recordId: 2,
        newValues: buildPasswordChangedAuditMetadata(),
      });
    });
    await expect(
      database.client.auditLog.count({ where: { action: "PASSWORD_CHANGED" } }),
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
        stockReversed: false,
      }),
    ).toEqual({
      reasonProvided: true,
      reasonLength: 7,
      approvedByUserId: 7,
      stockReversed: false,
    });
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
      reasonProvided: false,
      reasonLength: 0,
      approvedByUserId: 7,
    });

    for (const payload of [
      buildPasswordChangedAuditMetadata(),
      buildPinChangedAuditMetadata("verified"),
      buildManagerApprovalAuditMetadata({
        approverUserId: 1,
        action: "order.void",
        resourceType: "order",
        status: "consumed",
      }),
      buildOrderVoidAuditMetadata({
        reason: "customer changed mind",
        approvedByUserId: 1,
        stockReversed: true,
      }),
    ]) {
      const json = serializeSafeAuditMetadata(payload)!;
      expect(json).not.toMatch(/password|pin|token|sessionId/i);
      expect(json).not.toContain("customer changed mind");
    }
  });
});
