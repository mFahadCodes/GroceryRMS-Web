import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_REVOCATION_REASONS } from "../../../lib/security/auth-constants";
import { invalidateUsersForRoleChange } from "../../../lib/security/session-invalidation";

const databasePath = path.resolve(
  ".tmp/sec03a-role-permission-transaction.test.db",
);
const sidecars = [
  databasePath,
  `${databasePath}-journal`,
  `${databasePath}-shm`,
  `${databasePath}-wal`,
];
const migrations = [
  "prisma/migrations/20260720_000000_baseline/migration.sql",
  "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
].map((migration) => readFileSync(path.resolve(migration), "utf8"));
const NOW = new Date("2026-07-20T08:00:00.000Z");

function removeDatabase() {
  for (const file of sidecars) rmSync(file, { force: true });
}

describe("role-permission invalidation transaction", () => {
  let prisma: PrismaClient | undefined;

  function getPrisma(): PrismaClient {
    if (!prisma) throw new Error("Disposable Prisma client is not initialized");
    return prisma;
  }

  beforeAll(() => {
    removeDatabase();
    mkdirSync(path.dirname(databasePath), { recursive: true });
    let sqlite: Database.Database | undefined;
    try {
      sqlite = new Database(databasePath);
      for (const migration of migrations) sqlite.exec(migration);
    } finally {
      if (sqlite) sqlite.close();
    }
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databasePath }),
    });
  });

  beforeEach(async () => {
    const client = getPrisma();
    await client.userSession.deleteMany();
    await client.rolePermission.deleteMany();
    await client.user.deleteMany();
    await client.permission.deleteMany();
    await client.role.deleteMany();

    await client.role.createMany({
      data: [
        { id: 1, name: "Affected role" },
        { id: 2, name: "Other role" },
      ],
    });
    await client.permission.createMany({
      data: [
        { id: 1, name: "Old permission" },
        { id: 2, name: "New permission" },
      ],
    });
    await client.rolePermission.create({
      data: { roleId: 1, permissionId: 1, accessLevel: 5 },
    });
    await client.user.createMany({
      data: [
        {
          id: 7,
          username: "affected-one",
          fullName: "Affected One",
          passwordHash: "test-only-hash",
          roleId: 1,
        },
        {
          id: 8,
          username: "affected-two",
          fullName: "Affected Two",
          passwordHash: "test-only-hash",
          roleId: 1,
        },
        {
          id: 9,
          username: "other-user",
          fullName: "Other User",
          passwordHash: "test-only-hash",
          roleId: 2,
        },
      ],
    });
    await client.userSession.createMany({
      data: [7, 8, 9].map((userId) => ({
        sessionId: `test_session_${userId}_abcdefghijklmnop`,
        userId,
        authVersion: 1,
        loginAt: NOW,
        expiresAt: new Date("2026-07-21T08:00:00.000Z"),
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
      prisma = undefined;
    }
    removeDatabase();
  });

  async function replaceAffectedRolePermissions(shouldFail = false) {
    return getPrisma().$transaction(async (transaction) => {
      await transaction.rolePermission.deleteMany({ where: { roleId: 1 } });
      await transaction.rolePermission.create({
        data: { roleId: 1, permissionId: 2, accessLevel: 4 },
      });
      const result = await invalidateUsersForRoleChange(transaction, {
        roleId: 1,
        reason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
        now: NOW,
      });
      if (shouldFail) throw new Error("test transaction rollback");
      return result;
    });
  }

  it("permission changes invalidate users assigned to the role", async () => {
    await replaceAffectedRolePermissions();
    const client = getPrisma();
    const user = await client.user.findUniqueOrThrow({ where: { id: 7 } });
    const session = await client.userSession.findFirstOrThrow({
      where: { userId: 7 },
    });
    expect(user.authVersion).toBe(2);
    expect(session).toMatchObject({
      isActive: false,
      revokedReason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
    });
  });

  it("permission changes update every user assigned to the role", async () => {
    await expect(replaceAffectedRolePermissions()).resolves.toEqual({
      affectedUserCount: 2,
      revokedSessionCount: 2,
    });
    const affected = await getPrisma().user.findMany({
      where: { id: { in: [7, 8] } },
      orderBy: { id: "asc" },
    });
    expect(affected.map((user) => user.authVersion)).toEqual([2, 2]);
  });

  it("permission changes do not invalidate users assigned to another role", async () => {
    await replaceAffectedRolePermissions();
    const client = getPrisma();
    const user = await client.user.findUniqueOrThrow({ where: { id: 9 } });
    const session = await client.userSession.findFirstOrThrow({
      where: { userId: 9 },
    });
    expect(user.authVersion).toBe(1);
    expect(session).toMatchObject({ isActive: true, logoutAt: null });
  });

  it("permission replacement and invalidation commit together", async () => {
    await replaceAffectedRolePermissions();
    const client = getPrisma();
    await expect(
      client.rolePermission.findMany({ where: { roleId: 1 } }),
    ).resolves.toEqual([
      expect.objectContaining({ permissionId: 2, accessLevel: 4 }),
    ]);
    await expect(
      client.userSession.count({
        where: { userId: { in: [7, 8] }, isActive: true },
      }),
    ).resolves.toBe(0);
  });

  it("a failure rolls back both permission and authentication changes", async () => {
    await expect(replaceAffectedRolePermissions(true)).rejects.toThrow(
      "test transaction rollback",
    );
    const client = getPrisma();
    await expect(
      client.rolePermission.findMany({ where: { roleId: 1 } }),
    ).resolves.toEqual([
      expect.objectContaining({ permissionId: 1, accessLevel: 5 }),
    ]);
    const users = await client.user.findMany({
      where: { id: { in: [7, 8] } },
      orderBy: { id: "asc" },
    });
    expect(users.map((user) => user.authVersion)).toEqual([1, 1]);
    await expect(
      client.userSession.count({
        where: { userId: { in: [7, 8] }, isActive: true },
      }),
    ).resolves.toBe(2);
  });
});
