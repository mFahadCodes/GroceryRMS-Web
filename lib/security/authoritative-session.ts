import type { PrismaClient } from "@prisma/client";

export interface AuthoritativeSessionClaims {
  userId: unknown;
  sessionId: unknown;
  authVersion: unknown;
}

export interface AuthoritativeSessionRecord {
  sessionId: string | null;
  userId: number;
  authVersion: number | null;
  isActive: boolean;
  expiresAt: Date | null;
  logoutAt: Date | null;
  user: {
    id: number;
    isActive: boolean;
    authVersion: number;
    mustChangePassword: boolean;
    roleId: number;
    role: {
      id: number;
      isActive: boolean;
      rolePermissions: Array<{
        accessLevel: number;
        permission: {
          name: string;
          isActive: boolean;
        };
      }>;
    };
  };
}

export interface AuthoritativeSessionRepository {
  findBySessionId(sessionId: string): Promise<AuthoritativeSessionRecord | null>;
}

export function createPrismaAuthoritativeSessionRepository(
  client: Pick<PrismaClient, "userSession">,
): AuthoritativeSessionRepository {
  return {
    findBySessionId: (sessionId) =>
      client.userSession.findUnique({
        where: { sessionId },
        select: {
          sessionId: true,
          userId: true,
          authVersion: true,
          isActive: true,
          expiresAt: true,
          logoutAt: true,
          user: {
            select: {
              id: true,
              isActive: true,
              authVersion: true,
              mustChangePassword: true,
              roleId: true,
              role: {
                select: {
                  id: true,
                  isActive: true,
                  rolePermissions: {
                    select: {
                      accessLevel: true,
                      permission: {
                        select: { name: true, isActive: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
  };
}

export interface AuthoritativePrincipal {
  userId: number;
  roleId: number;
  permissions: string[];
  mustChangePassword: boolean;
}

export type AuthoritativeSessionFailureReason =
  | "INVALID_CLAIMS"
  | "SESSION_NOT_FOUND"
  | "USER_MISMATCH"
  | "USER_INACTIVE"
  | "SESSION_INACTIVE"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "AUTH_VERSION_MISMATCH"
  | "SESSION_VERSION_MISMATCH"
  | "ROLE_INACTIVE"
  | "DATABASE_ERROR";

export type AuthoritativeSessionResult =
  | { ok: true; principal: AuthoritativePrincipal }
  | { ok: false; reason: AuthoritativeSessionFailureReason };

export async function validateAuthoritativeSession(
  claims: AuthoritativeSessionClaims,
  repository: AuthoritativeSessionRepository,
  now = new Date(),
): Promise<AuthoritativeSessionResult> {
  const userId = parsePositiveInteger(claims.userId);
  const authVersion = parsePositiveInteger(claims.authVersion);
  const sessionId = parseSessionId(claims.sessionId);

  if (userId === null || authVersion === null || sessionId === null) {
    return { ok: false, reason: "INVALID_CLAIMS" };
  }

  let record: AuthoritativeSessionRecord | null;
  try {
    record = await repository.findBySessionId(sessionId);
  } catch {
    return { ok: false, reason: "DATABASE_ERROR" };
  }

  if (!record || record.sessionId !== sessionId) {
    return { ok: false, reason: "SESSION_NOT_FOUND" };
  }
  if (record.userId !== userId || record.user.id !== userId) {
    return { ok: false, reason: "USER_MISMATCH" };
  }
  if (!record.user.isActive) {
    return { ok: false, reason: "USER_INACTIVE" };
  }
  if (!record.isActive) {
    return { ok: false, reason: "SESSION_INACTIVE" };
  }
  if (record.logoutAt !== null) {
    return { ok: false, reason: "SESSION_REVOKED" };
  }
  if (!record.expiresAt || record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (record.user.authVersion !== authVersion) {
    return { ok: false, reason: "AUTH_VERSION_MISMATCH" };
  }
  if (record.authVersion === null || record.authVersion !== record.user.authVersion) {
    return { ok: false, reason: "SESSION_VERSION_MISMATCH" };
  }
  if (
    !record.user.role.isActive ||
    record.user.role.id !== record.user.roleId
  ) {
    return { ok: false, reason: "ROLE_INACTIVE" };
  }

  return {
    ok: true,
    principal: {
      userId,
      roleId: record.user.roleId,
      mustChangePassword: record.user.mustChangePassword,
      permissions: record.user.role.rolePermissions
        .filter((row) => row.permission.isActive)
        .map((row) => `${row.permission.name}:${row.accessLevel}`),
    },
  };
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function parseSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sessionId = value.trim();
  return sessionId.length >= 20 && sessionId.length <= 191 ? sessionId : null;
}
