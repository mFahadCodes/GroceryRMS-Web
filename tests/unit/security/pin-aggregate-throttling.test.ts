import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveThrottleKey, hashPinV2 } from "../../../lib/security/pin-hash";
import { verifyUserPin } from "../../../lib/services/pin-security-service";
import { createPinTestDatabase, seedPinUser } from "./pin-test-database";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const IP = "203.0.113.25";

describe("persistent aggregate PIN throttling", () => {
  const database = createPinTestDatabase("sec02a-aggregate-throttle");
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

  it("increments the IP bucket for a known-user failure", async () => {
    await verifyUserPin({ userId: 7, pin: "5937", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.pinThrottleState.findFirst({ select: { scope: true, failedAttempts: true } })).resolves.toEqual({ scope: "IP", failedAttempts: 1 });
  });
  it("increments the IP bucket for an unknown-user failure", async () => {
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.pinThrottleState.count()).resolves.toBe(1);
  });
  it("does not create a fake user for unknown targets", async () => {
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.user.count()).resolves.toBe(1);
  });
  it("performs dummy bcrypt work for an unknown user", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client);
    expect(compare).toHaveBeenCalledTimes(1);
  });
  it("performs dummy bcrypt work for an inactive user", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await database.client.user.update({ where: { id: 7 }, data: { isActive: false } });
    await verifyUserPin({ userId: 7, pin: "5937", clientIp: IP, now: NOW }, database.client);
    expect(compare).toHaveBeenCalledTimes(1);
  });
  it("performs dummy bcrypt work for an unusable v2 hash", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await database.client.user.update({ where: { id: 7 }, data: { pin: "pin-v2$malformed" } });
    await verifyUserPin({ userId: 7, pin: "5937", clientIp: IP, now: NOW }, database.client);
    expect(compare).toHaveBeenCalledTimes(1);
  });
  it("stores an HMAC key rather than the raw IP", async () => {
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client);
    const state = await database.client.pinThrottleState.findFirstOrThrow();
    expect(state.keyHash).toBe(deriveThrottleKey("IP", IP));
    expect(JSON.stringify(state)).not.toContain(IP);
  });
  it("locks the IP bucket at twenty-five failures", async () => {
    await seedBucket("IP", deriveThrottleKey("IP", IP), 24);
    await expect(verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client)).resolves.toEqual({ status: "throttled", retryAfterSeconds: 60 });
    const state = await database.client.pinThrottleState.findFirstOrThrow();
    expect(state.failedAttempts).toBe(25);
    expect(state.lockedUntil?.getTime()).toBe(NOW.getTime() + 15 * 60 * 1000);
  });
  it("locks an authoritative terminal bucket at fifteen failures", async () => {
    const key = deriveThrottleKey("TERMINAL", "3");
    await seedBucket("TERMINAL", key, 14);
    await expect(verifyUserPin({ userId: 999, pin: "5937", clientIp: "other-ip", authoritativeTerminalId: 3, now: NOW }, database.client)).resolves.toMatchObject({ status: "throttled" });
    const state = await database.client.pinThrottleState.findUniqueOrThrow({ where: { scope_keyHash: { scope: "TERMINAL", keyHash: key } } });
    expect(state.failedAttempts).toBe(15);
  });
  it("skips terminal state when no authoritative terminal exists", async () => {
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.pinThrottleState.count({ where: { scope: "TERMINAL" } })).resolves.toBe(0);
  });
  it("does not clear aggregate history after success", async () => {
    await seedBucket("IP", deriveThrottleKey("IP", IP), 3);
    await verifyUserPin({ userId: 7, pin: "4826", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.pinThrottleState.findFirst({ select: { failedAttempts: true } })).resolves.toEqual({ failedAttempts: 3 });
  });
  it("an expired bucket no longer throttles", async () => {
    const key = deriveThrottleKey("IP", IP);
    await database.client.pinThrottleState.create({ data: { scope: "IP", keyHash: key, failedAttempts: 25, windowStartedAt: new Date(NOW.getTime() - 20 * 60_000), lockedUntil: new Date(NOW.getTime() - 1), expiresAt: new Date(NOW.getTime() - 1) } });
    await expect(verifyUserPin({ userId: 7, pin: "4826", clientIp: IP, now: NOW }, database.client)).resolves.toMatchObject({ status: "verified" });
  });
  it("keeps different IP buckets independent", async () => {
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: "ip-one", now: NOW }, database.client);
    await verifyUserPin({ userId: 999, pin: "5937", clientIp: "ip-two", now: NOW }, database.client);
    await expect(database.client.pinThrottleState.count({ where: { scope: "IP" } })).resolves.toBe(2);
  });
  it("concurrent aggregate failures do not lose increments", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        verifyUserPin(
          { userId: 999, pin: "5937", clientIp: IP, now: NOW },
          database.client,
        ),
      ),
    );
    expect(results.every((result) => result.status === "failed")).toBe(true);
    await expect(
      database.client.pinThrottleState.findFirst({
        where: { scope: "IP" },
        select: { failedAttempts: true },
      }),
    ).resolves.toEqual({ failedAttempts: 4 });
  });
  it("bounded cleanup removes at most twenty-five expired records", async () => {
    await database.client.pinThrottleState.createMany({ data: Array.from({ length: 30 }, (_, index) => ({ scope: "IP", keyHash: `expired-${index}`, failedAttempts: 1, windowStartedAt: new Date(NOW.getTime() - 60_000), expiresAt: new Date(NOW.getTime() - 1) })) });
    await verifyUserPin({ userId: 7, pin: "4826", clientIp: IP, now: NOW }, database.client);
    await expect(database.client.pinThrottleState.count()).resolves.toBe(5);
  });

  async function seedBucket(scope: "IP" | "TERMINAL", keyHash: string, failedAttempts: number) {
    await database.client.pinThrottleState.create({ data: { scope, keyHash, failedAttempts, windowStartedAt: NOW, expiresAt: new Date(NOW.getTime() + 30 * 60_000) } });
  }
});
