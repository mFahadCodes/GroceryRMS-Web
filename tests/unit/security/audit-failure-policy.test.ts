import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { changeOwnPassword } from "../../../lib/services/password-service";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit failure policy", () => {
  const database = createManagerApprovalTestDatabase("sec05a-failure");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_audit_insert",
    );
    await resetManagerApprovalTables(database.client);
    await seedManagerApprovalFixture(database.client);
    await database.client.user.update({
      where: { id: 2 },
      data: {
        passwordHash: await hash("OldPass1!"),
        mustChangePassword: true,
      },
    });
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("transaction-required password audit failure rolls back the password change", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        changeOwnPassword(database.client, {
          userId: 2,
          currentPassword: "OldPass1!",
          newPassword: "NewPass1!",
        }),
      ).rejects.toThrow();
      const user = await database.client.user.findUniqueOrThrow({
        where: { id: 2 },
      });
      expect(user.mustChangePassword).toBe(true);
      await expect(
        database.client.auditLog.count({
          where: { action: "PASSWORD_CHANGED" },
        }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("best-effort auditLog failure does not throw to callers", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        auditLog({
          userId: 2,
          action: "BEST_EFFORT",
          newValues: { note: "still ok" },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("sanitizer exceptions fall back safely without persisting raw input", async () => {
    await writeAuditRecord(database.client, {
      userId: 2,
      action: "SANITIZER_SAFE",
      newValues: {
        password: "must-not-persist",
        note: "visible",
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SANITIZER_SAFE" },
    });
    expect(row.newValues).not.toContain("must-not-persist");
    expect(row.newValues).toContain("visible");
  });
});

async function hash(password: string) {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 4);
}
