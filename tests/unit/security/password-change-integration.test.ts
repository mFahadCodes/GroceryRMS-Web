import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaAuthoritativeSessionRepository, validateAuthoritativeSession } from "../../../lib/security/authoritative-session";
import { changeOwnPassword } from "../../../lib/services/password-service";

const databasePath = path.resolve(".tmp/sec01b-password-change.test.db");
const files = [databasePath, `${databasePath}-journal`, `${databasePath}-shm`, `${databasePath}-wal`];
const CURRENT = "current integration phrase";
const REPLACEMENT = "replacement integration phrase";
const NOW = new Date("2026-07-21T08:00:00.000Z");
const migrations = [
  "prisma/migrations/20260720_000000_baseline/migration.sql",
  "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
  "prisma/migrations/20260721_000000_add_password_rotation_state/migration.sql",
  "prisma/migrations/20260722_000000_add_pin_security_state/migration.sql",
].map((file) => readFileSync(path.resolve(file), "utf8"));

function cleanup() {
  for (const file of files) rmSync(file, { force: true });
}

describe("transactional password-change lifecycle", () => {
  let prisma: PrismaClient | undefined;

  function client() {
    if (!prisma) throw new Error("Disposable Prisma client is not initialized");
    return prisma;
  }

  beforeAll(() => {
    cleanup();
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = new Database(databasePath);
    try {
      for (const migration of migrations) sqlite.exec(migration);
    } finally {
      sqlite.close();
    }
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
  });

  beforeEach(async () => {
    const db = client();
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_password_audit"');
    await db.auditLog.deleteMany();
    await db.userSession.deleteMany();
    await db.user.deleteMany();
    await db.role.deleteMany();
    await db.role.create({ data: { id: 1, name: "Test Role" } });
    await db.user.create({
      data: {
        id: 7,
        username: "rotation-user",
        fullName: "Rotation User",
        passwordHash: await bcrypt.hash(CURRENT, 12),
        roleId: 1,
        mustChangePassword: true,
      },
    });
    await db.userSession.createMany({
      data: [
        { sessionId: "current_session_abcdefghijkl", userId: 7, authVersion: 1, loginAt: NOW, expiresAt: new Date("2026-07-22T08:00:00.000Z") },
        { sessionId: "concurrent_session_abcdefghij", userId: 7, authVersion: 1, loginAt: NOW, expiresAt: new Date("2026-07-22T08:00:00.000Z") },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    prisma = undefined;
    cleanup();
  });

  function change() {
    return changeOwnPassword(client(), {
      userId: 7,
      currentPassword: CURRENT,
      newPassword: REPLACEMENT,
      now: NOW,
      ipAddress: "127.0.0.1",
    });
  }

  it("changes the hash and clears rotation state with one version increment", async () => {
    await change();
    const user = await client().user.findUniqueOrThrow({ where: { id: 7 } });
    expect(user).toMatchObject({ mustChangePassword: false, passwordChangedAt: NOW, authVersion: 2 });
    expect(await bcrypt.compare(REPLACEMENT, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare(CURRENT, user.passwordHash)).toBe(false);
  });

  it("revokes the current and every concurrent session", async () => {
    await change();
    const sessions = await client().userSession.findMany({ orderBy: { id: "asc" } });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => !session.isActive && session.logoutAt?.getTime() === NOW.getTime())).toBe(true);
    expect(sessions.every((session) => session.revokedReason === "password-change")).toBe(true);
  });

  it("makes the old authoritative token fail", async () => {
    await change();
    const repository = createPrismaAuthoritativeSessionRepository(client());
    await expect(validateAuthoritativeSession({ userId: 7, sessionId: "current_session_abcdefghijkl", authVersion: 1 }, repository, NOW)).resolves.toMatchObject({ ok: false });
  });

  it("allows a new session on the new version with rotation cleared", async () => {
    await change();
    await client().userSession.create({
      data: { sessionId: "replacement_session_abcdefgh", userId: 7, authVersion: 2, loginAt: NOW, expiresAt: new Date("2026-07-22T08:00:00.000Z") },
    });
    const repository = createPrismaAuthoritativeSessionRepository(client());
    await expect(validateAuthoritativeSession({ userId: 7, sessionId: "replacement_session_abcdefgh", authVersion: 2 }, repository, NOW)).resolves.toMatchObject({ ok: true, principal: { mustChangePassword: false } });
  });

  it("stores only non-sensitive password-change audit metadata", async () => {
    await change();
    const audit = await client().auditLog.findFirstOrThrow();
    const serialized = JSON.stringify(audit);
    expect(audit.action).toBe("PASSWORD_CHANGED");
    expect(serialized).not.toContain(CURRENT);
    expect(serialized).not.toContain(REPLACEMENT);
    expect(serialized).not.toContain("current_session");
  });

  it("rolls back password, rotation, version, and sessions when audit fails", async () => {
    await client().$executeRawUnsafe('CREATE TRIGGER "fail_password_audit" BEFORE INSERT ON "audit_logs" WHEN NEW.action = \'PASSWORD_CHANGED\' BEGIN SELECT RAISE(ABORT, \'test audit failure\'); END');
    await expect(change()).rejects.toThrow();
    const user = await client().user.findUniqueOrThrow({ where: { id: 7 } });
    expect(user).toMatchObject({ mustChangePassword: true, passwordChangedAt: null, authVersion: 1 });
    expect(await bcrypt.compare(CURRENT, user.passwordHash)).toBe(true);
    expect(await client().userSession.count({ where: { isActive: true } })).toBe(2);
    expect(await client().auditLog.count()).toBe(0);
  });
});
