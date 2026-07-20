import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";
import { updateAuthoritativeJwt } from "../../../lib/security/auth-jwt";
import type { AuthoritativeSessionRecord } from "../../../lib/security/authoritative-session";

const SESSION_ID = "session_test_abcdefghijklmnop";

function record(): AuthoritativeSessionRecord {
  return {
    sessionId: SESSION_ID,
    userId: 7,
    authVersion: 3,
    isActive: true,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    logoutAt: null,
    user: {
      id: 7,
      isActive: true,
      authVersion: 3,
      roleId: 2,
      role: {
        id: 2,
        isActive: true,
        rolePermissions: [
          {
            accessLevel: 5,
            permission: { name: "Current permission", isActive: true },
          },
        ],
      },
    },
  };
}

function token(overrides: Partial<JWT> = {}): JWT {
  return {
    id: 7,
    sessionId: SESSION_ID,
    authVersion: 3,
    lastActivityAt: 1_000,
    ...overrides,
  };
}

function dependencies(session = record()) {
  return {
    repository: { findBySessionId: vi.fn(async () => session) },
    getIdleTimeoutMinutes: vi.fn(async () => 5),
  };
}

describe("authoritative JWT callback", () => {
  it("binds a newly issued JWT to the server-created session and auth version", async () => {
    const deps = dependencies();
    const user = {
      id: "7",
      roleId: 2,
      permissions: ["Initial permission:5"],
      sessionId: SESSION_ID,
      authVersion: 3,
    } as User;

    const result = await updateAuthoritativeJwt(
      { token: {}, user, now: 1_000 },
      deps,
    );

    expect(result).toMatchObject({
      id: 7,
      sessionId: SESSION_ID,
      authVersion: 3,
      roleId: 2,
      permissions: ["Initial permission:5"],
      lastActivityAt: 1_000,
      expired: false,
    });
    expect(deps.repository.findBySessionId).not.toHaveBeenCalled();
  });

  it("prevents token issuance when the login session ID is missing", async () => {
    const user = {
      id: "7",
      roleId: 2,
      permissions: [],
      sessionId: "",
      authVersion: 3,
    } as User;
    await expect(
      updateAuthoritativeJwt({ token: {}, user }, dependencies()),
    ).resolves.toBeNull();
  });

  it("does not create another database session during ordinary callbacks", async () => {
    const deps = dependencies();
    await updateAuthoritativeJwt({ token: token(), now: 2_000 }, deps);
    expect(deps.repository.findBySessionId).toHaveBeenCalledOnce();
    expect(deps.repository.findBySessionId).toHaveBeenCalledWith(SESSION_ID);
  });

  it("refreshes role permissions from authoritative database state", async () => {
    const result = await updateAuthoritativeJwt(
      {
        token: token({ roleId: 99, permissions: ["Stale permission:5"] }),
        now: 2_000,
      },
      dependencies(),
    );
    expect(result).toMatchObject({
      roleId: 2,
      permissions: ["Current permission:5"],
    });
  });

  it("rejects a token after its authentication version becomes stale", async () => {
    const staleRecord = record();
    staleRecord.user.authVersion = 4;
    await expect(
      updateAuthoritativeJwt(
        { token: token(), now: 2_000 },
        dependencies(staleRecord),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a legacy token instead of upgrading it", async () => {
    const deps = dependencies();
    await expect(
      updateAuthoritativeJwt({ token: { id: 7 }, now: 2_000 }, deps),
    ).resolves.toBeNull();
    expect(deps.repository.findBySessionId).not.toHaveBeenCalled();
  });

  it("marks an idle token expired without making it valid again", async () => {
    const first = await updateAuthoritativeJwt(
      { token: token({ lastActivityAt: 1_000 }), now: 302_001 },
      dependencies(),
    );
    expect(first?.expired).toBe(true);

    const second = await updateAuthoritativeJwt(
      { token: first!, now: 302_002 },
      dependencies(),
    );
    expect(second?.expired).toBe(true);
  });

  it("fails closed when authoritative database validation throws", async () => {
    const deps = dependencies();
    deps.repository.findBySessionId.mockRejectedValueOnce(
      new Error("test database unavailable"),
    );
    await expect(
      updateAuthoritativeJwt({ token: token(), now: 2_000 }, deps),
    ).resolves.toBeNull();
  });

  it("fails closed when idle-timeout configuration cannot be loaded", async () => {
    const deps = dependencies();
    deps.getIdleTimeoutMinutes.mockRejectedValueOnce(
      new Error("test settings unavailable"),
    );
    await expect(
      updateAuthoritativeJwt({ token: token(), now: 2_000 }, deps),
    ).resolves.toBeNull();
  });
});
