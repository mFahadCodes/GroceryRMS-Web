import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { hashPin } from "@/lib/pin";
import { loadPermissionTokensForRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

import { resolveClientIp } from "@/lib/client-ip";
import { SESSION_REVOCATION_REASONS } from "@/lib/security/auth-constants";
import { createAuthoritativeLoginSession } from "@/lib/security/login-session";
import { revokeCurrentSession } from "@/lib/security/session-invalidation";

type LoginType = "password" | "pin";

async function authenticateWithPassword(username: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { username, isActive: true },
    include: { role: true },
  });

  if (!user) {
    return null;
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    return null;
  }

  return user;
}

async function authenticateWithPin(pin: string) {
  const pinHash = hashPin(pin);
  return prisma.user.findFirst({
    where: { pin: pinHash, isActive: true },
    include: { role: true },
  });
}

export async function recordLogin(
  userId: number,
  authVersion: number,
  ipAddress: string,
) {
  return createAuthoritativeLoginSession(prisma, {
    userId,
    authVersion,
    ipAddress,
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        pin: { label: "PIN", type: "text" },
        loginType: { label: "Login Type", type: "text" },
      },
      async authorize(credentials, request) {
        const loginType =
          typeof credentials?.loginType === "string"
            ? (credentials.loginType as LoginType)
            : undefined;

        let user = null;

        if (loginType === "pin") {
          const pin =
            typeof credentials?.pin === "string" ? credentials.pin.trim() : "";
          const username =
            typeof credentials?.username === "string"
              ? credentials.username.trim()
              : "";
          if (!pin) {
            return null;
          }
          if (username) {
            const account = await prisma.user.findFirst({
              where: { username, isActive: true },
            });
            if (!account || !account.pin) {
              return null;
            }
            user = account.pin === hashPin(pin) ? account : null;
          } else {
            user = await authenticateWithPin(pin);
          }
        } else {
          const username =
            typeof credentials?.username === "string"
              ? credentials.username.trim()
              : "";
          const password =
            typeof credentials?.password === "string"
              ? credentials.password
              : "";
          if (!username || !password) {
            return null;
          }
          user = await authenticateWithPassword(username, password);
        }

        if (!user) {
          return null;
        }

        const permissions = await loadPermissionTokensForRole(user.roleId);
        const ipAddress = request ? resolveClientIp(request) : "unknown";
        const dbSession = await recordLogin(
          user.id,
          user.authVersion,
          ipAddress,
        );
        if (!dbSession.sessionId) {
          throw new Error("Failed to create authoritative session");
        }

        return {
          id: String(user.id),
          name: user.fullName,
          email: user.email ?? undefined,
          roleId: user.roleId,
          permissions,
          sessionId: dbSession.sessionId,
          authVersion: user.authVersion,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sessionId = token?.sessionId;
      const userId = token?.id;

      if (typeof sessionId !== "string" || typeof userId !== "number") {
        return;
      }

      await revokeCurrentSession(prisma, {
        sessionId,
        userId,
        reason: SESSION_REVOCATION_REASONS.LOGOUT,
      });
    },
  },
});
