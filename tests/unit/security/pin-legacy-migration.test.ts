import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isV2PinHash, verifyV2PinHash } from "../../../lib/security/pin-hash";
import { verifyUserPin } from "../../../lib/services/pin-security-service";
import { createPinTestDatabase, seedPinUser } from "./pin-test-database";

const NOW = new Date("2026-07-22T08:00:00.000Z");
const legacyHash = createHash("sha256").update("1111").digest("hex");

describe("lazy legacy PIN migration", () => {
  const database = createPinTestDatabase("sec02a-legacy");

  beforeAll(async () => {});
  beforeEach(async () => {
    await database.client.auditLog.deleteMany();
    await database.client.pinThrottleState.deleteMany();
    await database.client.user.deleteMany();
    await database.client.role.deleteMany();
    await seedPinUser(database.client, { id: 7, pin: legacyHash });
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  const verify = (pin: string) =>
    verifyUserPin({ userId: 7, pin, clientIp: "198.51.100.7", now: NOW }, database.client);

  it("accepts a correct legacy PIN without revealing migration", async () => {
    await expect(verify("1111")).resolves.toMatchObject({ status: "verified", user: { id: 7 } });
  });
  it("replaces a successful legacy hash with v2", async () => {
    await verify("1111");
    const user = await database.client.user.findUniqueOrThrow({ where: { id: 7 } });
    expect(isV2PinHash(user.pin)).toBe(true);
    await expect(verifyV2PinHash(7, "1111", user.pin!)).resolves.toBe(true);
  });
  it("migrates an existing weak PIN even though new creation rejects it", async () => {
    await expect(verify("1111")).resolves.toMatchObject({ status: "verified" });
  });
  it("clears user failure state in the migration transaction", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 4, pinLastFailedAt: NOW } });
    await verify("1111");
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLastFailedAt: true, pinLockedUntil: true } })).resolves.toEqual({ pinFailedAttempts: 0, pinLastFailedAt: null, pinLockedUntil: null });
  });
  it("does not migrate an incorrect legacy PIN", async () => {
    await expect(verify("2222")).resolves.toMatchObject({ status: "failed" });
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pin: true } })).resolves.toEqual({ pin: legacyHash });
  });
  it("records migration and success without sensitive material", async () => {
    await verify("1111");
    const serialized = JSON.stringify(await database.client.auditLog.findMany());
    expect(serialized).toContain("PIN_HASH_UPGRADED");
    expect(serialized).not.toContain("1111");
    expect(serialized).not.toContain(legacyHash);
  });
  it("rolls back migration and reset when audit insertion fails", async () => {
    await database.client.$executeRawUnsafe('CREATE TRIGGER fail_pin_migration_audit BEFORE INSERT ON audit_logs WHEN NEW.action = \'PIN_HASH_UPGRADED\' BEGIN SELECT RAISE(ABORT, \'test failure\'); END');
    try {
      await expect(verify("1111")).resolves.toEqual({ status: "security-unavailable" });
      await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pin: true } })).resolves.toEqual({ pin: legacyHash });
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_pin_migration_audit");
    }
  });
});
