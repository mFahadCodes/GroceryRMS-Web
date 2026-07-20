import { describe, expect, it, vi } from "vitest";
import {
  type AuthoritativeSessionClaims,
  type AuthoritativeSessionRecord,
  validateAuthoritativeSession,
} from "../../../lib/security/authoritative-session";

const SESSION_ID = "session_test_abcdefghijklmnop";
const NOW = new Date("2026-07-20T08:00:00.000Z");

function validRecord(): AuthoritativeSessionRecord {
  return {
    sessionId: SESSION_ID,
    userId: 7,
    authVersion: 3,
    isActive: true,
    expiresAt: new Date("2026-07-21T08:00:00.000Z"),
    logoutAt: null,
    user: {
      id: 7,
      isActive: true,
      authVersion: 3,
      mustChangePassword: false,
      roleId: 2,
      role: {
        id: 2,
        isActive: true,
        rolePermissions: [
          {
            accessLevel: 5,
            permission: { name: "Manage users & roles", isActive: true },
          },
          {
            accessLevel: 1,
            permission: { name: "Retired permission", isActive: false },
          },
        ],
      },
    },
  };
}

function repository(record: AuthoritativeSessionRecord | null = validRecord()) {
  return { findBySessionId: vi.fn(async () => record) };
}

function claims() {
  return { userId: 7, sessionId: SESSION_ID, authVersion: 3 };
}

describe("authoritative session validation", () => {
  it("accepts a valid active user and active database session", async () => {
    await expect(
      validateAuthoritativeSession(claims(), repository(), NOW),
    ).resolves.toEqual({
      ok: true,
      principal: {
        userId: 7,
        roleId: 2,
        permissions: ["Manage users & roles:5"],
        mustChangePassword: false,
      },
    });
  });

  it.each(["missing user", "deleted user", "missing session"])(
    "rejects a %s lookup",
    async () => {
      await expect(
        validateAuthoritativeSession(claims(), repository(null), NOW),
      ).resolves.toEqual({ ok: false, reason: "SESSION_NOT_FOUND" });
    },
  );

  it("rejects an inactive user", async () => {
    const record = validRecord();
    record.user.isActive = false;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "USER_INACTIVE" });
  });

  it("rejects a session owned by another user", async () => {
    const record = validRecord();
    record.userId = 8;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "USER_MISMATCH" });
  });

  it("rejects a revoked session", async () => {
    const record = validRecord();
    record.logoutAt = new Date("2026-07-20T07:00:00.000Z");
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_REVOKED" });
  });

  it("rejects an expired session", async () => {
    const record = validRecord();
    record.expiresAt = new Date("2026-07-20T07:59:59.999Z");
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("rejects a legacy session without an expiry", async () => {
    const record = validRecord();
    record.expiresAt = null;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("rejects an inactive session", async () => {
    const record = validRecord();
    record.isActive = false;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_INACTIVE" });
  });

  const legacyClaimCases: Array<[
    Partial<AuthoritativeSessionClaims>,
    string,
  ]> = [
    [{ userId: 7, authVersion: 3 }, "missing session ID"],
    [{ userId: 7, sessionId: SESSION_ID }, "missing auth version"],
    [{ sessionId: SESSION_ID, authVersion: 3 }, "missing user ID"],
  ];

  it.each(legacyClaimCases)(
    "rejects legacy claims with %s (%s)",
    async (partialClaims) => {
    const lookup = repository();
    await expect(
      validateAuthoritativeSession(
        {
          userId: partialClaims.userId,
          sessionId: partialClaims.sessionId,
          authVersion: partialClaims.authVersion,
        },
        lookup,
        NOW,
      ),
    ).resolves.toEqual({ ok: false, reason: "INVALID_CLAIMS" });
    expect(lookup.findBySessionId).not.toHaveBeenCalled();
    },
  );

  it("rejects a user auth-version mismatch", async () => {
    const record = validRecord();
    record.user.authVersion = 4;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "AUTH_VERSION_MISMATCH" });
  });

  it("rejects a session auth-version mismatch", async () => {
    const record = validRecord();
    record.authVersion = 2;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_VERSION_MISMATCH" });
  });

  it("rejects a legacy session without an auth version", async () => {
    const record = validRecord();
    record.authVersion = null;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "SESSION_VERSION_MISMATCH" });
  });

  it("rejects a missing or inactive role relationship", async () => {
    const record = validRecord();
    record.user.role.isActive = false;
    await expect(
      validateAuthoritativeSession(claims(), repository(record), NOW),
    ).resolves.toEqual({ ok: false, reason: "ROLE_INACTIVE" });
  });

  it("fails closed on a database validation error", async () => {
    const lookup = {
      findBySessionId: vi.fn(async () => {
        throw new Error("test database unavailable");
      }),
    };
    await expect(
      validateAuthoritativeSession(claims(), lookup, NOW),
    ).resolves.toEqual({ ok: false, reason: "DATABASE_ERROR" });
  });

  it("does not expose password hashes, PIN hashes, or session identifiers", async () => {
    const result = await validateAuthoritativeSession(claims(), repository(), NOW);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("pin");
    expect(serialized).not.toContain(SESSION_ID);
  });

  it.each([true, false])(
    "returns authoritative password-rotation state %s",
    async (mustChangePassword) => {
      const record = validRecord();
      record.user.mustChangePassword = mustChangePassword;
      await expect(
        validateAuthoritativeSession(claims(), repository(record), NOW),
      ).resolves.toMatchObject({
        ok: true,
        principal: { mustChangePassword },
      });
    },
  );
});
