import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import {
  type AuthoritativeSessionRepository,
  validateAuthoritativeSession,
} from "./authoritative-session";

export async function updateAuthoritativeJwt(
  input: { token: JWT; user?: User; now?: number },
  dependencies: {
    repository: AuthoritativeSessionRepository;
    getIdleTimeoutMinutes(): Promise<number>;
  },
): Promise<JWT | null> {
  const now = input.now ?? Date.now();

  if (input.user) {
    const userId = Number(input.user.id);
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      typeof input.user.sessionId !== "string" ||
      input.user.sessionId.length < 20 ||
      !Number.isSafeInteger(input.user.authVersion) ||
      input.user.authVersion <= 0
    ) {
      return null;
    }

    input.token.id = userId;
    input.token.roleId = input.user.roleId;
    input.token.permissions = input.user.permissions;
    input.token.sessionId = input.user.sessionId;
    input.token.authVersion = input.user.authVersion;
    input.token.terminalId = null;
    input.token.mustChangePassword = input.user.mustChangePassword;
    input.token.lastActivityAt = now;
    input.token.expired = false;
    return input.token;
  }

  const validation = await validateAuthoritativeSession(
    {
      userId: input.token.id,
      sessionId: input.token.sessionId,
      authVersion: input.token.authVersion,
    },
    dependencies.repository,
  );
  if (!validation.ok) {
    return null;
  }

  input.token.id = validation.principal.userId;
  input.token.sessionId = validation.principal.sessionId;
  input.token.authVersion = validation.principal.authVersion;
  input.token.terminalId = validation.principal.terminalId;
  input.token.roleId = validation.principal.roleId;
  input.token.permissions = validation.principal.permissions;
  input.token.mustChangePassword = validation.principal.mustChangePassword;

  let idleMinutes: number;
  try {
    idleMinutes = await dependencies.getIdleTimeoutMinutes();
  } catch {
    return null;
  }

  const lastActivity =
    typeof input.token.lastActivityAt === "number"
      ? input.token.lastActivityAt
      : now;

  if (input.token.expired || now - lastActivity > idleMinutes * 60 * 1000) {
    input.token.expired = true;
    return input.token;
  }

  input.token.lastActivityAt = now;
  input.token.expired = false;
  return input.token;
}
