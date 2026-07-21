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

import {
  writeBestEffortAudit,
  writeRequiredAudit,
} from "../../../lib/audit";
import { changeOwnPassword } from "../../../lib/services/password-service";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit failure policy", () => {
  const database = createManagerApprovalTestDatabase("sec05b-failure");

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

  it("transaction-required password audit failure rolls back the password change", async () => {
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

  it("best-effort audit failure does not throw to callers", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
      await expect(
        writeBestEffortAudit({
          userId: 2,
          action: "UPDATE_ORDER_META",
          newValues: { notesProvided: true, customerId: null },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("sanitizer exceptions fall back safely without persisting raw input", async () => {
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "UPDATE_USER",
        recordId: 2,
        newValues: {
          fieldsChanged: ["username"],
          passwordChanged: false,
          pinChanged: false,
          username: "cashier",
        },
      });
    });
    // Defense in depth: even if a builder somehow included a secret key,
    // writeBestEffortAudit still redacts through the sanitizer path.
    await writeBestEffortAudit({
      userId: 2,
      action: "CREATE_ORDER",
      recordId: 50,
      newValues: {
        password: "must-not-persist",
        note: "visible",
      },
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CREATE_ORDER" },
    });
    expect(row.newValues).not.toContain("must-not-persist");
    expect(row.newValues).toContain("visible");
  });
});

async function hash(password: string) {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 4);
}
