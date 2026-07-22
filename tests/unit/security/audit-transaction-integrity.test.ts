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

import { writeBestEffortAudit, writeRequiredAudit } from "../../../lib/audit";
import { buildPasswordChangedAuditMetadata } from "../../../lib/security/audit-metadata";
import { changeOwnPassword } from "../../../lib/services/password-service";
import { forceLogoutSession } from "../../../lib/services/session-service";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit transaction integrity", () => {
  const database = createManagerApprovalTestDatabase("sec05b-txn-integrity");

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
        passwordHash: await hash("current secure test phrase"),
        mustChangePassword: true,
      },
    });
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("password change success writes PASSWORD_CHANGED and clears mustChangePassword", async () => {
    await changeOwnPassword(database.client, {
      userId: 2,
      currentPassword: "current secure test phrase",
      newPassword: "replacement secure test phrase",
    });
    const user = await database.client.user.findUniqueOrThrow({
      where: { id: 2 },
    });
    expect(user.mustChangePassword).toBe(false);
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "PASSWORD_CHANGED" },
    });
    expect(audit.userId).toBe(2);
    expect(audit.recordId).toBe(2);
    expect(audit.tableName).toBe("users");
  });

  it("password change with audit trigger failure rolls back the mutation", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        changeOwnPassword(database.client, {
          userId: 2,
          currentPassword: "current secure test phrase",
          newPassword: "replacement secure test phrase",
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

  it("force logout with audit failure rolls back the session revocation", async () => {
    const session = await database.client.userSession.findFirstOrThrow({
      where: { userId: 2, isActive: true },
    });
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        forceLogoutSession(session.id, { actorUserId: 7 }),
      ).rejects.toThrow();
      const after = await database.client.userSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(after.isActive).toBe(true);
      expect(after.logoutAt).toBeNull();
      await expect(
        database.client.auditLog.count({ where: { action: "FORCE_LOGOUT" } }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("best-effort UPDATE_ORDER_META style failure does not throw", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        writeBestEffortAudit({
          userId: 2,
          action: "UPDATE_ORDER_META",
          recordId: 50,
          newValues: { notesProvided: true, customerId: null },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("after forced audit failure is removed, required audit succeeds again", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: 2,
          action: "PASSWORD_CHANGED",
          recordId: 2,
          newValues: buildPasswordChangedAuditMetadata(),
        });
      }),
    ).rejects.toThrow();
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_audit_insert",
    );
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
});

async function hash(password: string) {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 4);
}
