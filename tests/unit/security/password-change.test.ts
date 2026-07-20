import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  changeOwnPassword,
  PasswordChangeError,
} from "../../../lib/services/password-service";

const CURRENT = "current secure test phrase";
const REPLACEMENT = "replacement secure test phrase";
const NOW = new Date("2026-07-21T08:00:00.000Z");

function harness(options: {
  user?: { id: number; username: string; passwordHash: string; authVersion: number } | null;
  reuse?: boolean;
  updatedCount?: number;
  hashFailure?: boolean;
  sessionFailure?: boolean;
  auditFailure?: boolean;
} = {}) {
  const user = options.user === undefined
    ? { id: 7, username: "rotation-user", passwordHash: "stored-hash", authVersion: 3 }
    : options.user;
  const findFirst = vi.fn(async (_input: unknown) => user);
  const updateMany = vi.fn(async (_input: unknown) => ({ count: options.updatedCount ?? 1 }));
  const sessionUpdateMany = vi.fn(async (_input: unknown) => {
    if (options.sessionFailure) throw new Error("test session failure");
    return { count: 2 };
  });
  const auditCreate = vi.fn(async (_input: unknown) => {
    if (options.auditFailure) throw new Error("test audit failure");
    return { id: 1 };
  });
  const transaction = vi.fn(async (operation: (store: unknown) => unknown) =>
    operation({
      user: { updateMany },
      userSession: { updateMany: sessionUpdateMany },
      auditLog: { create: auditCreate },
    }),
  );
  const compare = vi.fn(async (plain: string) =>
    plain === CURRENT || (options.reuse === true && plain === REPLACEMENT),
  );
  const hash = vi.fn(async (_plain: string, _cost: number) => {
    if (options.hashFailure) throw new Error("test hash failure");
    return "replacement-hash";
  });
  const client = { user: { findFirst }, $transaction: transaction } as unknown as PrismaClient;
  return { client, findFirst, updateMany, sessionUpdateMany, auditCreate, transaction, compare, hash };
}

function run(test: ReturnType<typeof harness>, overrides: Partial<{ currentPassword: string; newPassword: string }> = {}) {
  return changeOwnPassword(
    test.client,
    {
      userId: 7,
      currentPassword: overrides.currentPassword ?? CURRENT,
      newPassword: overrides.newPassword ?? REPLACEMENT,
      now: NOW,
      ipAddress: "127.0.0.1",
    },
    { compare: test.compare, hash: test.hash },
  );
}

describe("secure self-service password change", () => {
  it("verifies the current password and accepts a compliant replacement", async () => {
    const test = harness();
    await expect(run(test)).resolves.toMatchObject({
      passwordChanged: true,
      reauthenticationRequired: true,
    });
    expect(test.compare).toHaveBeenCalledWith(CURRENT, "stored-hash");
  });

  it.each([
    [null, CURRENT],
    [{ id: 7, username: "rotation-user", passwordHash: "", authVersion: 3 }, CURRENT],
    [{ id: 7, username: "rotation-user", passwordHash: "stored-hash", authVersion: 3 }, "incorrect test phrase"],
  ] as const)("fails safely for missing, passwordless, or invalid accounts", async (user, currentPassword) => {
    const test = harness({ user });
    await expect(run(test, { currentPassword })).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    expect(test.transaction).not.toHaveBeenCalled();
  });

  it("rejects a replacement that violates the shared policy", async () => {
    const test = harness();
    await expect(run(test, { newPassword: "too short" })).rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION" });
    expect(test.hash).not.toHaveBeenCalled();
  });

  it("rejects reuse of the current password before mutation", async () => {
    const test = harness({ reuse: true });
    await expect(run(test)).rejects.toMatchObject({ code: "PASSWORD_REUSE_NOT_ALLOWED" });
    expect(test.transaction).not.toHaveBeenCalled();
    expect(test.sessionUpdateMany).not.toHaveBeenCalled();
  });

  it("hashes the exact replacement with bcrypt cost 12", async () => {
    const test = harness();
    await run(test);
    expect(test.hash).toHaveBeenCalledWith(REPLACEMENT, 12);
  });

  it("updates the hash, rotation state, timestamp, and authVersion together", async () => {
    const test = harness();
    await run(test);
    expect(test.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 7, passwordHash: "stored-hash", authVersion: 3 }),
      data: {
        passwordHash: "replacement-hash",
        mustChangePassword: false,
        passwordChangedAt: NOW,
        authVersion: { increment: 1 },
      },
    }));
  });

  it("revokes current and concurrent active sessions with a safe reason", async () => {
    const test = harness();
    await run(test);
    expect(test.sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 7, isActive: true, logoutAt: null },
      data: { isActive: false, logoutAt: NOW, revokedReason: "password-change" },
    });
  });

  it("creates no replacement database session", async () => {
    const test = harness();
    await run(test);
    expect(JSON.stringify(test.transaction.mock.calls)).not.toContain("sessionId");
  });

  it("writes only non-sensitive audit metadata inside the transaction", async () => {
    const test = harness();
    await run(test);
    const serialized = JSON.stringify(test.auditCreate.mock.calls);
    expect(serialized).toContain("PASSWORD_CHANGED");
    expect(serialized).not.toContain(CURRENT);
    expect(serialized).not.toContain(REPLACEMENT);
    expect(serialized).not.toContain("replacement-hash");
  });

  it("hashing failure causes no transaction or mutation", async () => {
    const test = harness({ hashFailure: true });
    await expect(run(test)).rejects.toThrow("test hash failure");
    expect(test.transaction).not.toHaveBeenCalled();
  });

  it("a concurrent user change prevents session revocation", async () => {
    const test = harness({ updatedCount: 0 });
    await expect(run(test)).rejects.toBeInstanceOf(PasswordChangeError);
    expect(test.sessionUpdateMany).not.toHaveBeenCalled();
    expect(test.auditCreate).not.toHaveBeenCalled();
  });

  it("session revocation failure prevents a success audit and result", async () => {
    const test = harness({ sessionFailure: true });
    await expect(run(test)).rejects.toThrow("test session failure");
    expect(test.auditCreate).not.toHaveBeenCalled();
  });

  it("audit failure prevents a success result", async () => {
    const test = harness({ auditFailure: true });
    await expect(run(test)).rejects.toThrow("test audit failure");
  });

  it("never returns passwords, hashes, authVersion, or session identifiers", async () => {
    const result = await run(harness());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/passwordHash|authVersion|sessionId/i);
    expect(serialized).not.toContain(CURRENT);
    expect(serialized).not.toContain(REPLACEMENT);
  });
});
