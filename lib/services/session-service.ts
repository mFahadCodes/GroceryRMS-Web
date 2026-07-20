import { ServiceError } from "@/lib/api/service-error";
import { prisma } from "@/lib/prisma";

export async function listActiveSessions() {
  return prisma.userSession.findMany({
    where: { logoutAt: null, isActive: true },
    include: {
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
    },
    orderBy: { loginAt: "desc" },
  });
}

export async function forceLogoutSession(sessionId: number) {
  const session = await prisma.userSession.findFirst({
    where: { id: sessionId, logoutAt: null, isActive: true },
    include: {
      user: { select: { id: true, username: true, fullName: true } },
    },
  });

  if (!session) {
    throw new ServiceError("Session not found or already logged out", "SESSION_NOT_FOUND", 404);
  }

  return prisma.userSession.update({
    where: { id: sessionId },
    data: { logoutAt: new Date() },
    include: {
      user: { select: { id: true, username: true, fullName: true } },
      terminal: { select: { id: true, name: true } },
    },
  });
}
