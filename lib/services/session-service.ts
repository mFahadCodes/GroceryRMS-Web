import { ServiceError } from "@/lib/api/service-error";
import { writeRequiredAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { buildSessionForceLogoutAuditMetadata } from "@/lib/security/audit-metadata";
import { SESSION_REVOCATION_REASONS } from "@/lib/security/auth-constants";
import { revokeSessionById } from "@/lib/security/session-invalidation";

const safeSessionSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  isActive: true,
  userId: true,
  terminalId: true,
  loginAt: true,
  expiresAt: true,
  logoutAt: true,
  ipAddress: true,
  user: {
    select: {
      id: true,
      username: true,
      fullName: true,
      roleId: true,
      role: { select: { id: true, name: true } },
    },
  },
  terminal: { select: { id: true, name: true } },
} as const;

export async function listSessions(now = new Date()) {
  const sessions = await prisma.userSession.findMany({
    select: safeSessionSelect,
    orderBy: { loginAt: "desc" },
  });

  return sessions.map((session) => ({
    ...session,
    status: session.logoutAt
      ? "revoked"
      : !session.isActive
        ? "inactive"
        : !session.expiresAt || session.expiresAt <= now
          ? "expired"
          : "active",
  }));
}

export async function forceLogoutSession(
  sessionId: number,
  securityContext: { actorUserId: number; ipAddress?: string | null },
) {
  return prisma.$transaction(async (transaction) => {
    const session = await transaction.userSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        user: { select: { username: true } },
      },
    });

    if (!session) {
      throw new ServiceError("Session not found", "SESSION_NOT_FOUND", 404);
    }

    await revokeSessionById(transaction, {
      sessionId,
      reason: SESSION_REVOCATION_REASONS.ADMINISTRATOR,
    });

    // SEC-05B: force logout is a security mutation; its audit shares the
    // revocation transaction so a revocation can never commit unaudited.
    await writeRequiredAudit(transaction, {
      userId: securityContext.actorUserId,
      action: "FORCE_LOGOUT",
      recordId: sessionId,
      newValues: buildSessionForceLogoutAuditMetadata({
        userId: session.userId,
        username: session.user.username,
      }),
      ipAddress: securityContext.ipAddress ?? null,
    });

    return transaction.userSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: safeSessionSelect,
    });
  });
}
