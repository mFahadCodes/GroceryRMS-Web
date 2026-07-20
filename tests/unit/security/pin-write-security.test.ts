import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isV2PinHash, verifyV2PinHash } from "../../../lib/security/pin-hash";
import { createUser, updateUser } from "../../../lib/services/settings-service";
import { createPinTestDatabase } from "./pin-test-database";

describe("administrative PIN writes", () => {
  const database = createPinTestDatabase("sec02a-pin-writes");
  beforeEach(async () => {
    await database.client.auditLog.deleteMany();
    await database.client.userSession.deleteMany();
    await database.client.user.deleteMany();
    await database.client.role.deleteMany();
    await database.client.role.createMany({ data: [{ id: 1, name: "Admin" }, { id: 2, name: "Cashier" }] });
    await database.client.user.create({ data: { id: 1, username: "actor", fullName: "Actor", passwordHash: "actor-hash", roleId: 1 } });
    await database.client.user.create({ data: { id: 7, username: "target", fullName: "Target", passwordHash: "target-hash", pin: null, roleId: 2, mustChangePassword: true } });
    await database.client.userSession.create({ data: { sessionId: "pin_write_session_abcdefghijkl", userId: 7, authVersion: 1, expiresAt: new Date("2026-07-23T00:00:00.000Z") } });
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("creates new users with a v2 user-bound PIN hash", async () => {
    const created = await createUser({ username: "new-user", fullName: "New User", password: "test password", pin: "4826", roleId: 2 }, { actorUserId: 1 }, database.client);
    const stored = await database.client.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(isV2PinHash(stored.pin)).toBe(true);
    await expect(verifyV2PinHash(stored.id, "4826", stored.pin!)).resolves.toBe(true);
  });
  it("does not return password or PIN hashes from user creation", async () => {
    const created = await createUser({ username: "new-user", fullName: "New User", password: "test password", pin: "4826", roleId: 2 }, { actorUserId: 1 }, database.client);
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|pin-v2/);
  });
  it("PIN change writes v2 and increments authVersion once", async () => {
    await updateUser(7, { pin: "5937" }, { actorUserId: 1 }, database.client);
    const user = await database.client.user.findUniqueOrThrow({ where: { id: 7 } });
    expect(user.authVersion).toBe(2);
    expect(isV2PinHash(user.pin)).toBe(true);
  });
  it("PIN change revokes every active session", async () => {
    await updateUser(7, { pin: "5937" }, { actorUserId: 1 }, database.client);
    await expect(database.client.userSession.findFirst({ select: { isActive: true, revokedReason: true } })).resolves.toEqual({ isActive: false, revokedReason: "credential-change" });
  });
  it("PIN change preserves password rotation state", async () => {
    await updateUser(7, { pin: "5937" }, { actorUserId: 1 }, database.client);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { mustChangePassword: true } })).resolves.toEqual({ mustChangePassword: true });
  });
  it("records no plaintext PIN in its audit", async () => {
    await updateUser(7, { pin: "5937" }, { actorUserId: 1 }, database.client);
    const serialized = JSON.stringify(await database.client.auditLog.findMany());
    expect(serialized).toContain("PIN_CHANGED");
    expect(serialized).not.toContain("5937");
  });
  it("rolls back PIN, version, sessions, and audit together", async () => {
    await database.client.$executeRawUnsafe('CREATE TRIGGER fail_pin_change_audit BEFORE INSERT ON audit_logs WHEN NEW.action = \'PIN_CHANGED\' BEGIN SELECT RAISE(ABORT, \'test failure\'); END');
    try {
      await expect(updateUser(7, { pin: "5937" }, { actorUserId: 1 }, database.client)).rejects.toThrow();
      await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pin: true, authVersion: true } })).resolves.toEqual({ pin: null, authVersion: 1 });
      await expect(database.client.userSession.count({ where: { isActive: true } })).resolves.toBe(1);
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_pin_change_audit");
    }
  });
});
