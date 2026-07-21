import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPinV2 } from "../../../lib/security/pin-hash";
import { verifyUserPin } from "../../../lib/services/pin-security-service";
import { createPinTestDatabase, seedPinUser } from "./pin-test-database";

const BASE = new Date("2026-07-22T09:00:00.000Z");

describe("persistent per-user PIN throttling", () => {
  const database = createPinTestDatabase("sec02a-user-throttle");
  beforeEach(async () => {
    await database.client.auditLog.deleteMany();
    await database.client.pinThrottleState.deleteMany();
    await database.client.user.deleteMany();
    await database.client.role.deleteMany();
    await seedPinUser(database.client, { id: 7, pin: await hashPinV2(7, "4826") });
  });
  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  const failAt = (now: Date) => verifyUserPin({ userId: 7, pin: "5937", clientIp: `ip-${now.getTime()}`, now }, database.client);

  it("does not lock failures one through four", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 2, pinLastFailedAt: BASE } });
    await expect(failAt(BASE)).resolves.toEqual({ status: "failed" });
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLockedUntil: true } })).resolves.toEqual({ pinFailedAttempts: 3, pinLockedUntil: null });
  });
  it.each([
    [4, 60],
    [6, 5 * 60],
    [8, 15 * 60],
    [10, 30 * 60],
  ])("locks after failure count following %i for %i seconds", async (prior, seconds) => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: prior, pinLastFailedAt: BASE } });
    await expect(failAt(BASE)).resolves.toMatchObject({ status: "throttled" });
    const state = await database.client.user.findUniqueOrThrow({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLockedUntil: true } });
    expect(state.pinFailedAttempts).toBe(prior + 1);
    expect(state.pinLockedUntil?.getTime()).toBe(BASE.getTime() + seconds * 1000);
  });
  it("decays the counter after thirty minutes without failure", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 10, pinLastFailedAt: new Date(BASE.getTime() - 31 * 60 * 1000), pinLockedUntil: new Date(BASE.getTime() - 1000) } });
    await failAt(BASE);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLockedUntil: true } })).resolves.toEqual({ pinFailedAttempts: 1, pinLockedUntil: null });
  });
  it("allows verification after an expired lock", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 5, pinLastFailedAt: BASE, pinLockedUntil: new Date(BASE.getTime() - 1) } });
    await expect(verifyUserPin({ userId: 7, pin: "4826", clientIp: "success-ip", now: BASE }, database.client)).resolves.toMatchObject({ status: "verified" });
  });
  it("success clears only user-specific failure state", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 4, pinLastFailedAt: BASE } });
    await verifyUserPin({ userId: 7, pin: "4826", clientIp: "success-ip", now: BASE }, database.client);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true, pinLastFailedAt: true, pinLockedUntil: true } })).resolves.toEqual({ pinFailedAttempts: 0, pinLastFailedAt: null, pinLockedUntil: null });
  });
  it("concurrent failures do not lose increments", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) => verifyUserPin({ userId: 7, pin: "5937", clientIp: `concurrent-${index}`, now: BASE }, database.client)),
    );
    expect(results.every((result) => result.status === "failed")).toBe(true);
    await expect(database.client.user.findUnique({ where: { id: 7 }, select: { pinFailedAttempts: true } })).resolves.toEqual({ pinFailedAttempts: 4 });
  });
  it("an active user lock returns only a generic throttle result", async () => {
    await database.client.user.update({ where: { id: 7 }, data: { pinFailedAttempts: 5, pinLastFailedAt: BASE, pinLockedUntil: new Date(BASE.getTime() + 60_000) } });
    await expect(failAt(BASE)).resolves.toEqual({ status: "throttled", retryAfterSeconds: 60 });
  });
});
