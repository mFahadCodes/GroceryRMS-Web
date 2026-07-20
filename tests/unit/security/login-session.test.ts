import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "../../../lib/security/auth-constants";
import { createAuthoritativeLoginSession } from "../../../lib/security/login-session";

const NOW = new Date("2026-07-20T08:00:00.000Z");

type SessionCreateInput = {
  data: {
    userId: number;
    authVersion: number;
    loginAt: Date;
    expiresAt: Date;
    ipAddress: string;
  };
};

function harness() {
  const userUpdate = vi.fn(async (_input: unknown) => ({ id: 7 }));
  let nextSession = 1;
  const sessionCreate = vi.fn(async (_input: SessionCreateInput) => ({
    id: nextSession,
    sessionId: `server_generated_session_${nextSession++}`,
  }));
  const transaction = vi.fn(async (operation: (store: unknown) => unknown) =>
    operation({
      user: { update: userUpdate },
      userSession: { create: sessionCreate },
    }),
  );
  const client = { $transaction: transaction } as unknown as PrismaClient;
  return { client, transaction, userUpdate, sessionCreate };
}

function create(client: PrismaClient) {
  return createAuthoritativeLoginSession(client, {
    userId: 7,
    authVersion: 3,
    ipAddress: "127.0.0.1",
    now: NOW,
  });
}

describe("authoritative login session creation", () => {
  it("creates exactly one database session for a successful login", async () => {
    const test = harness();
    await create(test.client);
    expect(test.transaction).toHaveBeenCalledOnce();
    expect(test.sessionCreate).toHaveBeenCalledOnce();
  });

  it("lets the database generate the unpredictable session identifier", async () => {
    const test = harness();
    await create(test.client);
    const createData = test.sessionCreate.mock.calls[0]![0].data;
    expect(createData).not.toHaveProperty("sessionId");
  });

  it("stores the current user authentication version", async () => {
    const test = harness();
    await create(test.client);
    expect(test.sessionCreate.mock.calls[0]![0].data).toMatchObject({
      userId: 7,
      authVersion: 3,
    });
  });

  it("uses an expiry matching the configured JWT lifetime", async () => {
    const test = harness();
    await create(test.client);
    const data = test.sessionCreate.mock.calls[0]![0].data;
    expect(data.expiresAt.getTime() - NOW.getTime()).toBe(
      AUTH_SESSION_MAX_AGE_SECONDS * 1000,
    );
  });

  it("updates last login and creates the session in one transaction", async () => {
    const test = harness();
    await create(test.client);
    expect(test.userUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastLoginAt: NOW },
    });
    expect(test.transaction).toHaveBeenCalledOnce();
  });

  it("prevents token issuance when session creation fails", async () => {
    const test = harness();
    test.sessionCreate.mockRejectedValueOnce(new Error("test create failure"));
    await expect(create(test.client)).rejects.toThrow("test create failure");
  });

  it("gives concurrent logins different server-generated identifiers", async () => {
    const test = harness();
    const [first, second] = await Promise.all([
      create(test.client),
      create(test.client),
    ]);
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(test.sessionCreate).toHaveBeenCalledTimes(2);
  });

  it("never persists a raw JWT, cookie, authorization header, password, or PIN", async () => {
    const test = harness();
    await create(test.client);
    const serialized = JSON.stringify(test.sessionCreate.mock.calls[0]![0].data);
    expect(serialized).not.toMatch(/jwt|cookie|authorization|password|pin/i);
  });
});
