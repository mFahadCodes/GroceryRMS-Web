import type { PrismaClient } from "@prisma/client";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "./auth-constants";

export async function createAuthoritativeLoginSession(
  client: PrismaClient,
  input: {
    userId: number;
    authVersion: number;
    ipAddress: string;
    now?: Date;
  },
) {
  const loginAt = input.now ?? new Date();
  const expiresAt = new Date(
    loginAt.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  );

  return client.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: input.userId },
      data: { lastLoginAt: loginAt },
    });

    return transaction.userSession.create({
      data: {
        userId: input.userId,
        authVersion: input.authVersion,
        loginAt,
        expiresAt,
        ipAddress: input.ipAddress,
      },
    });
  });
}
