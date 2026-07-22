import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSettingUpsertAuditMetadata } from "../../../lib/security/audit-metadata";

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

import { upsertSetting } from "../../../lib/services/settings-service";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit settings policy", () => {
  const database = createManagerApprovalTestDatabase("sec05b-settings");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_audit_insert",
    );
    await resetManagerApprovalTables(database.client);
    await seedManagerApprovalFixture(database.client);
    await database.client.appSetting.deleteMany();
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("buildSettingUpsertAuditMetadata never includes value", () => {
    const metadata = buildSettingUpsertAuditMetadata({
      settingKey: "PaymentGatewaySecret",
      dataType: "string",
      value: "sk_live_should_never_appear",
    });
    expect(metadata).toEqual({
      settingKey: "PaymentGatewaySecret",
      dataType: "string",
      valuePresent: true,
    });
    expect("value" in metadata).toBe(false);
    expect(JSON.stringify(metadata)).not.toContain("sk_live");
  });

  it("upsertSetting with actor writes UPSERT_SETTING transactionally", async () => {
    const setting = await upsertSetting(
      "StoreName",
      { value: "Corner Market", dataType: "string", group: "General" },
      { actorUserId: 2, ipAddress: "203.0.113.50" },
    );
    expect(setting.key).toBe("StoreName");
    expect(setting.value).toBe("Corner Market");
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "UPSERT_SETTING" },
    });
    expect(audit.userId).toBe(2);
    expect(audit.tableName).toBe("app_settings");
    expect(audit.recordId).toBe(setting.id);
    expect(audit.ipAddress).toBe("203.0.113.50");
    expect(audit.newValues).toContain("StoreName");
    expect(audit.newValues).toContain('"valuePresent":true');
    expect(audit.newValues).not.toContain("Corner Market");
  });

  it("upsertSetting audit failure rolls back the setting write", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        upsertSetting(
          "StorePhone",
          { value: "555-0100", dataType: "string" },
          { actorUserId: 2 },
        ),
      ).rejects.toThrow();
      await expect(
        database.client.appSetting.findUnique({ where: { key: "StorePhone" } }),
      ).resolves.toBeNull();
      await expect(
        database.client.auditLog.count({ where: { action: "UPSERT_SETTING" } }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("allows null actor for system maintenance upserts that still audit", async () => {
    const setting = await upsertSetting(
      "LastBackupAt",
      { value: "2026-07-22T00:00:00.000Z", dataType: "string" },
      { actorUserId: null },
    );
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "UPSERT_SETTING", recordId: setting.id },
    });
    expect(audit.userId).toBeNull();
    expect(audit.newValues).not.toContain("2026-07-22");
  });
});
