import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPolicyError } from "../../../lib/security/audit-policy";
import {
  buildOrderCheckoutAuditMetadata,
  buildPasswordChangedAuditMetadata,
  buildUserAccountAuditMetadata,
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

import { writeRequiredAudit } from "../../../lib/audit";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("writeRequiredAudit wrapper", () => {
  const database = createManagerApprovalTestDatabase("sec05b-required");

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

  it("rejects the root prisma client which exposes $transaction", async () => {
    await expect(
      writeRequiredAudit(database.client, {
        userId: 2,
        action: "PASSWORD_CHANGED",
        recordId: 2,
        newValues: buildPasswordChangedAuditMetadata(),
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      writeRequiredAudit(database.client, {
        userId: 2,
        action: "PASSWORD_CHANGED",
        recordId: 2,
        newValues: buildPasswordChangedAuditMetadata(),
      }),
    ).rejects.toThrow(/transaction client/);
  });

  it("accepts a transaction client and persists the audit row", async () => {
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "PASSWORD_CHANGED",
        recordId: 2,
        newValues: buildPasswordChangedAuditMetadata(),
      });
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "PASSWORD_CHANGED" },
    });
    expect(row.userId).toBe(2);
    expect(row.recordId).toBe(2);
    expect(row.tableName).toBe("users");
  });

  it("requires an actor when the policy requiresActor", async () => {
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: null,
          action: "CHECKOUT",
          recordId: 50,
          newValues: buildOrderCheckoutAuditMetadata({
            terminalId: 1,
            paymentMethodIds: [1],
            grandTotal: 1000n,
          }),
        });
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          action: "CHECKOUT",
          recordId: 50,
          newValues: buildOrderCheckoutAuditMetadata({
            terminalId: 1,
            paymentMethodIds: [1],
            grandTotal: 1000n,
          }),
        });
      }),
    ).rejects.toThrow(/requires an authenticated actor/);
  });

  it("requires an entity id when the policy requiresEntityId", async () => {
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: 2,
          action: "UPDATE_USER",
          recordId: null,
          newValues: buildUserAccountAuditMetadata({
            fieldsChanged: ["username"],
            username: "cashier",
          }),
        });
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: 2,
          action: "UPDATE_USER",
          newValues: buildUserAccountAuditMetadata({
            fieldsChanged: ["username"],
            username: "cashier",
          }),
        });
      }),
    ).rejects.toThrow(/requires an entity record id/);
  });

  it("rejects missing transaction identity requirements together", async () => {
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: null,
          action: "FORCE_LOGOUT",
          recordId: null,
          newValues: { userId: 2, username: "requester" },
        });
      }),
    ).rejects.toThrow(AuditPolicyError);
    await expect(
      database.client.auditLog.count({ where: { action: "FORCE_LOGOUT" } }),
    ).resolves.toBe(0);
  });

  it("uses the registry entity table and ignores caller-supplied table intent", async () => {
    await database.client.$transaction(async (tx) => {
      await writeRequiredAudit(tx, {
        userId: 2,
        action: "CHECKOUT",
        recordId: 50,
        newValues: buildOrderCheckoutAuditMetadata({
          terminalId: 1,
          paymentMethodIds: [3, 4],
          grandTotal: 2500n,
        }),
      });
    });
    const row = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CHECKOUT" },
    });
    expect(row.tableName).toBe("orders");
    expect(row.tableName).not.toBe("products");
  });

  it("propagates SQLite audit trigger failures out of the wrapper", async () => {
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    try {
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

  it("rejects best-effort actions passed to the required wrapper", async () => {
    await expect(
      database.client.$transaction(async (tx) => {
        await writeRequiredAudit(tx, {
          userId: 2,
          action: "UPDATE_ORDER_META" as "CHECKOUT",
          recordId: 50,
          newValues: buildOrderCheckoutAuditMetadata({
            terminalId: 1,
            paymentMethodIds: [1],
            grandTotal: 1n,
          }),
        });
      }),
    ).rejects.toThrow(AuditPolicyError);
  });
});
