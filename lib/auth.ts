import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { loadPermissionTokensForRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

import { resolveClientIp } from "@/lib/client-ip";
import { SESSION_REVOCATION_REASONS } from "@/lib/security/auth-constants";
import { createAuthoritativeLoginSession } from "@/lib/security/login-session";
import { revokeCurrentSession } from "@/lib/security/session-invalidation";
import { verifyUserPin } from "@/lib/services/pin-security-service";

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

export class PinThrottledCredentialsError extends CredentialsSignin {
  code = "pin_throttled";
}

export class PinSecurityUnavailableCredentialsError extends CredentialsSignin {
  code = "pin_security_unavailable";
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
        userId: { label: "User ID", type: "text" },
        loginType: { label: "Login Type", type: "text" },
      },
      async authorize(credentials, request) {
        const loginType =
          typeof credentials?.loginType === "string"
            ? (credentials.loginType as LoginType)
            : undefined;

        let user:
          | {
              id: number;
              fullName: string;
              email?: string | null;
              roleId: number;
              authVersion: number;
              mustChangePassword: boolean;
              permissions?: string[];
            }
          | null = null;

        if (loginType === "pin") {
          const pin = typeof credentials?.pin === "string" ? credentials.pin : "";
          const userId = Number(credentials?.userId);
          if (!pin || !Number.isSafeInteger(userId) || userId <= 0) {
            return null;
          }
          const verification = await verifyUserPin({
            userId,
            pin,
            clientIp: request ? resolveClientIp(request) : "unknown",
          });
          if (verification.status === "throttled") {
            throw new PinThrottledCredentialsError();
          }
          if (verification.status === "security-unavailable") {
            throw new PinSecurityUnavailableCredentialsError();
          }
          if (verification.status !== "verified") return null;
          const current = await prisma.user.findFirst({
            where: { id: verification.user.id, isActive: true },
            select: {
              id: true,
              fullName: true,
              email: true,
              roleId: true,
              authVersion: true,
              mustChangePassword: true,
            },
          });
          user = current
            ? { ...current, permissions: verification.user.permissions }
            : null;
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

        const permissions =
          user.permissions ?? (await loadPermissionTokensForRole(user.roleId));
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
          mustChangePassword: user.mustChangePassword,
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
