import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetUserPinLockout } from "../../../lib/services/pin-security-service";
import { createPinTestDatabase, seedPinUser } from "./pin-test-database";

describe("administrative PIN lockout reset", () => {
  const database = createPinTestDatabase("sec02a-lockout-reset");
  beforeEach(async () => {
    await database.client.auditLog.deleteMany();
    await database.client.pinThrottleState.deleteMany();
    await database.client.user.deleteMany();
    await database.client.role.deleteMany();
    await seedPinUser(database.client, { id: 1, pin: null });
    await seedPinUser(database.client, { id: 7, pin: "stored-hash", isActive: false });
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 11, pinLastFailedAt: new Date(), pinLockedUntil: new Date(Date.now() + 60_000) } });
    await database.client.pinThrottleState.create({ data: { scope: "IP", keyHash: "opaque-key", failedAttempts: 25, windowStartedAt: new Date(), lockedUntil: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 120_000) } });
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("clears only user-specific failure state", async () => {
    await resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLastFailedAt: true, pinLockedUntil: true } })).resolves.toEqual({ pinFailedAttempts: 0, pinLastFailedAt: null, pinLockedUntil: null });
  });
  it("does not change the PIN or active state", async () => {
    await resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pin: true, isActive: true } })).resolves.toEqual({ pin: "stored-hash", isActive: false });
  });
  it("does not clear aggregate throttle history", async () => {
    await resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client);
    await expect(database.client.pinThrottleState.count()).resolves.toBe(1);
  });
  it("is idempotent for repeated resets", async () => {
    await resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client);
    await expect(resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client)).resolves.toEqual({ reset: true });
  });
  it("records only safe audit metadata", async () => {
    await resetUserPinLockout({ userId: 7, actorUserId: 1 }, database.client);
    const audit = await database.client.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({ userId: 1, action: "PIN_LOCKOUT_RESET", recordId: 7 });
    expect(JSON.stringify(audit)).not.toContain("stored-hash");
  });
  it("does not create a user for an unknown target", async () => {
    await expect(resetUserPinLockout({ userId: 999, actorUserId: 1 }, database.client)).resolves.toEqual({ reset: false });
    await expect(database.client.user.count()).resolves.toBe(2);
  });
});
