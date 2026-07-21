import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPolicyError } from "../../../lib/security/audit-policy";
import { buildOrderMetadataUpdateAuditMetadata } from "../../../lib/security/audit-metadata";

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
  accessAuditFromRequest,
  writeAccessAudit,
  writeBestEffortAudit,
} from "../../../lib/audit";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("writeBestEffortAudit and access audit wrappers", () => {
  const database = createManagerApprovalTestDatabase("sec05b-best-effort");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_audit_insert",
    );
    await resetManagerApprovalTables(database.client);
    await seedManagerApprovalFixture(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("persists a successful best-effort audit", async () => {
    await writeBestEffortAudit({
      userId: 2,
      action: "UPDATE_ORDER_META",
      recordId: 50,
      newValues: buildOrderMetadataUpdateAuditMetadata({
        notes: "hello",
        customerId: null,
      }),
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "UPDATE_ORDER_META" },
    });
    expect(row.tableName).toBe("orders");
    expect(row.newValues).toContain('"notesProvided":true');
    expect(row.newValues).not.toContain("hello");
  });

  it("does not throw when best-effort persistence fails via trigger", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        writeBestEffortAudit({
          userId: 2,
          action: "CREATE_PRODUCT",
          recordId: 1,
          newValues: { nameProvided: true },
        }),
      ).resolves.toBeUndefined();
      await expect(database.client.auditLog.count()).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("rejects TRANSACTION_REQUIRED actions with AuditPolicyError", async () => {
    await expect(
      writeBestEffortAudit({
        userId: 2,
        action: "PASSWORD_CHANGED" as "CREATE_PRODUCT",
        recordId: 2,
        newValues: { success: true },
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      writeBestEffortAudit({
        userId: 2,
        action: "CHECKOUT" as "CREATE_ORDER",
        recordId: 50,
        newValues: {},
      }),
    ).rejects.toThrow(/not best-effort/);
  });

  it("writeAccessAudit failure does not throw", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        writeAccessAudit({
          userId: 2,
          action: "PRINT_RECEIPT",
          recordId: 50,
          newValues: { format: "thermal" },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("accessAuditFromRequest failure does not throw", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      const request = new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      });
      await expect(
        accessAuditFromRequest(request, {
          userId: 2,
          action: "OPEN_DRAWER",
          recordId: 1,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("persists access activity with registry entity table", async () => {
    await writeAccessAudit({
      userId: 2,
      action: "DB_BACKUP",
      recordId: null,
      newValues: { destination: "local" },
      tableName: "should-be-ignored",
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "DB_BACKUP" },
    });
    expect(row.tableName).toBe("database");
  });

  it("rejects mutation events through writeAccessAudit", async () => {
    await expect(
      writeAccessAudit({
        userId: 2,
        action: "VOID_ORDER" as "PRINT_RECEIPT",
        recordId: 50,
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      writeAccessAudit({
        userId: 2,
        action: "UPDATE_ORDER_META" as "OPEN_DRAWER",
        recordId: 50,
      }),
    ).rejects.toThrow(/not access activity/);
  });

  it("uses registry entity table for best-effort writes despite tableName override", async () => {
    await writeBestEffortAudit({
      userId: 2,
      action: "CREATE_PRODUCT",
      recordId: 99,
      tableName: "not_products",
      newValues: { skuProvided: true },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CREATE_PRODUCT" },
    });
    expect(row.tableName).toBe("products");
  });
});
