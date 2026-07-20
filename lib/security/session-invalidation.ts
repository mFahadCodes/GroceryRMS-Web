import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionRevocationReason } from "@/lib/security/auth-constants";

type AuthenticationStore = Pick<Prisma.TransactionClient, "user" | "userSession">;

export async function revokeCurrentSession(
  store: AuthenticationStore,
  input: {
    sessionId: string;
    userId: number;
    reason: SessionRevocationReason;
    now?: Date;
  },
) {
  return store.userSession.updateMany({
    where: {
      sessionId: input.sessionId,
      userId: input.userId,
      isActive: true,
      logoutAt: null,
    },
    data: {
      isActive: false,
      logoutAt: input.now ?? new Date(),
      revokedReason: input.reason,
    },
  });
}

export async function revokeSessionById(
  store: AuthenticationStore,
  input: {
    sessionId: number;
    reason: SessionRevocationReason;
    now?: Date;
  },
) {
  return store.userSession.updateMany({
    where: {
      id: input.sessionId,
      isActive: true,
      logoutAt: null,
    },
    data: {
      isActive: false,
      logoutAt: input.now ?? new Date(),
      revokedReason: input.reason,
    },
  });
}

export async function invalidateUserAuthentication(
  store: AuthenticationStore,
  input: {
    userId: number;
    reason: SessionRevocationReason;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const user = await store.user.update({
    where: { id: input.userId },
    data: { authVersion: { increment: 1 } },
    select: { id: true, authVersion: true },
  });
  const sessions = await store.userSession.updateMany({
    where: {
      userId: input.userId,
      isActive: true,
      logoutAt: null,
    },
    data: {
      isActive: false,
      logoutAt: now,
      revokedReason: input.reason,
    },
  });

  return { user, revokedSessionCount: sessions.count };
}

export async function invalidateUsersForRoleChange(
  store: AuthenticationStore,
  input: {
    roleId: number;
    reason: SessionRevocationReason;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const affectedUsers = await store.user.findMany({
    where: { roleId: input.roleId },
    select: { id: true },
  });
  const userIds = affectedUsers.map((user) => user.id);

  if (userIds.length === 0) {
    return { affectedUserCount: 0, revokedSessionCount: 0 };
  }

  const users = await store.user.updateMany({
    where: { id: { in: userIds } },
    data: { authVersion: { increment: 1 } },
  });
  const sessions = await store.userSession.updateMany({
    where: {
      userId: { in: userIds },
      isActive: true,
      logoutAt: null,
    },
    data: {
      isActive: false,
      logoutAt: now,
      revokedReason: input.reason,
    },
  });

  return {
    affectedUserCount: users.count,
    revokedSessionCount: sessions.count,
  };
}

export async function revokeAllUserSessions(
  client: PrismaClient,
  input: {
    userId: number;
    reason: SessionRevocationReason;
    now?: Date;
  },
) {
  return client.$transaction((transaction) =>
    invalidateUserAuthentication(transaction, input),
  );
}
