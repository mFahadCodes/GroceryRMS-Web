import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SESSION_REVOCATION_REASONS } from "../../../lib/security/auth-constants";
import {
  invalidateUserAuthentication,
  invalidateUsersForRoleChange,
  revokeAllUserSessions,
  revokeCurrentSession,
  revokeSessionById,
} from "../../../lib/security/session-invalidation";

const NOW = new Date("2026-07-20T08:00:00.000Z");

function store() {
  return {
    user: {
      update: vi.fn(async (_input: unknown) => ({ id: 7, authVersion: 4 })),
      updateMany: vi.fn(async (_input: unknown) => ({ count: 2 })),
      findMany: vi.fn(async (_input: unknown) => [{ id: 7 }, { id: 8 }]),
    },
    userSession: {
      updateMany: vi.fn(async (_input: unknown) => ({ count: 2 })),
    },
  };
}

function asAuthenticationStore(db: ReturnType<typeof store>) {
  return db as never;
}

function firstInput<T>(mock: { mock: { calls: unknown[][] } }): T {
  return mock.mock.calls[0]![0] as T;
}

describe("authoritative session invalidation", () => {
  it("normal logout revokes only the current user's opaque session", async () => {
    const db = store();
    await revokeCurrentSession(asAuthenticationStore(db), {
      sessionId: "session_current_abcdefghijkl",
      userId: 7,
      reason: SESSION_REVOCATION_REASONS.LOGOUT,
      now: NOW,
    });

    expect(db.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session_current_abcdefghijkl",
        userId: 7,
        isActive: true,
        logoutAt: null,
      },
      data: {
        isActive: false,
        logoutAt: NOW,
        revokedReason: SESSION_REVOCATION_REASONS.LOGOUT,
      },
    });
  });

  it("normal logout leaves another concurrent session outside the update", async () => {
    const db = store();
    await revokeCurrentSession(asAuthenticationStore(db), {
      sessionId: "session_first_abcdefghijklmn",
      userId: 7,
      reason: SESSION_REVOCATION_REASONS.LOGOUT,
      now: NOW,
    });
    const { where } = firstInput<{ where: Record<string, unknown> }>(
      db.userSession.updateMany,
    );
    expect(where).not.toHaveProperty("userId", { in: expect.anything() });
    expect(where.sessionId).toBe("session_first_abcdefghijklmn");
  });

  it("repeated logout is safe because only active, unrevoked rows match", async () => {
    const db = store();
    db.userSession.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      revokeCurrentSession(asAuthenticationStore(db), {
        sessionId: "session_already_abcdefghijkl",
        userId: 7,
        reason: SESSION_REVOCATION_REASONS.LOGOUT,
      }),
    ).resolves.toEqual({ count: 0 });
  });

  it("a revocation update can never reactivate a session", async () => {
    const db = store();
    await revokeCurrentSession(asAuthenticationStore(db), {
      sessionId: "session_current_abcdefghijkl",
      userId: 7,
      reason: SESSION_REVOCATION_REASONS.LOGOUT,
      now: NOW,
    });
    expect(
      firstInput<{ data: { isActive: boolean } }>(db.userSession.updateMany).data
        .isActive,
    ).toBe(false);
  });

  it("administrator revocation targets one numeric session record", async () => {
    const db = store();
    await revokeSessionById(asAuthenticationStore(db), {
      sessionId: 42,
      reason: SESSION_REVOCATION_REASONS.ADMINISTRATOR,
      now: NOW,
    });
    expect(db.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42, isActive: true, logoutAt: null },
      }),
    );
  });

  it("global invalidation atomically increments the user version and revokes all active sessions", async () => {
    const db = store();
    await expect(
      invalidateUserAuthentication(asAuthenticationStore(db), {
        userId: 7,
        reason: SESSION_REVOCATION_REASONS.LOGOUT_ALL,
        now: NOW,
      }),
    ).resolves.toEqual({
      user: { id: 7, authVersion: 4 },
      revokedSessionCount: 2,
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { authVersion: { increment: 1 } },
      select: { id: true, authVersion: true },
    });
    expect(db.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, isActive: true, logoutAt: null },
      }),
    );
  });

  it.each([
    SESSION_REVOCATION_REASONS.CREDENTIAL_CHANGE,
    SESSION_REVOCATION_REASONS.ACCOUNT_STATUS_CHANGE,
    SESSION_REVOCATION_REASONS.ROLE_CHANGE,
    SESSION_REVOCATION_REASONS.LOGOUT_ALL,
  ])("records the non-sensitive invalidation reason %s", async (reason) => {
    const db = store();
    await invalidateUserAuthentication(asAuthenticationStore(db), {
      userId: 7,
      reason,
      now: NOW,
    });
    expect(
      firstInput<{ data: { revokedReason: string } }>(
        db.userSession.updateMany,
      ).data.revokedReason,
    ).toBe(reason);
  });

  it("does not attempt session revocation when the version increment fails", async () => {
    const db = store();
    db.user.update.mockRejectedValueOnce(new Error("test update failure"));
    await expect(
      invalidateUserAuthentication(asAuthenticationStore(db), {
        userId: 7,
        reason: SESSION_REVOCATION_REASONS.CREDENTIAL_CHANGE,
      }),
    ).rejects.toThrow("test update failure");
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });

  it("uses atomic increments during concurrent or repeated invalidation", async () => {
    const db = store();
    await Promise.all([
      invalidateUserAuthentication(asAuthenticationStore(db), {
        userId: 7,
        reason: SESSION_REVOCATION_REASONS.CREDENTIAL_CHANGE,
      }),
      invalidateUserAuthentication(asAuthenticationStore(db), {
        userId: 7,
        reason: SESSION_REVOCATION_REASONS.CREDENTIAL_CHANGE,
      }),
    ]);
    expect(db.user.update).toHaveBeenCalledTimes(2);
    for (const [call] of db.user.update.mock.calls) {
      const input = call as { data: { authVersion: unknown } };
      expect(input.data.authVersion).toEqual({ increment: 1 });
    }
  });

  it("role permission changes invalidate every user assigned to that role", async () => {
    const db = store();
    await expect(
      invalidateUsersForRoleChange(asAuthenticationStore(db), {
        roleId: 2,
        reason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
        now: NOW,
      }),
    ).resolves.toEqual({ affectedUserCount: 2, revokedSessionCount: 2 });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { roleId: 2 },
      select: { id: true },
    });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 8] } },
      data: { authVersion: { increment: 1 } },
    });
  });

  it("role invalidation excludes users assigned to another role", async () => {
    const db = store();
    await invalidateUsersForRoleChange(asAuthenticationStore(db), {
      roleId: 2,
      reason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
      now: NOW,
    });
    expect(
      firstInput<{ where: { userId: unknown } }>(db.userSession.updateMany).where
        .userId,
    ).toEqual({ in: [7, 8] });
  });

  it("a role with no assigned users performs no version or session writes", async () => {
    const db = store();
    db.user.findMany.mockResolvedValueOnce([]);
    await expect(
      invalidateUsersForRoleChange(asAuthenticationStore(db), {
        roleId: 2,
        reason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
      }),
    ).resolves.toEqual({ affectedUserCount: 0, revokedSessionCount: 0 });
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });

  it("logout-all runs version increment and revocation inside one transaction", async () => {
    const db = store();
    const transaction = vi.fn(async (operation: (tx: unknown) => unknown) =>
      operation(db),
    );
    const client = { $transaction: transaction } as unknown as PrismaClient;
    await revokeAllUserSessions(client, {
      userId: 7,
      reason: SESSION_REVOCATION_REASONS.LOGOUT_ALL,
      now: NOW,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(db.user.update).toHaveBeenCalledOnce();
    expect(db.userSession.updateMany).toHaveBeenCalledOnce();
  });
});
