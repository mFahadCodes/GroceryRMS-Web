import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { hashPin } from "@/lib/pin";
import { loadPermissionTokensForRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

import { resolveClientIp } from "@/lib/client-ip";

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

export async function recordLogin(userId: number, ipAddress: string) {
  const loginAt = new Date();

  const dbSession = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: loginAt },
    });

    return tx.userSession.create({
      data: {
        userId,
        loginAt,
        ipAddress,
      },
    });
  });

  return dbSession;
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

        const ipAddress = request ? resolveClientIp(request) : "unknown";
        const dbSession = await recordLogin(user.id, ipAddress);
        const permissions = await loadPermissionTokensForRole(user.roleId);

        return {
          id: String(user.id),
          name: user.fullName,
          email: user.email ?? undefined,
          roleId: user.roleId,
          permissions,
          dbSessionId: dbSession.id,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const dbSessionId = token?.dbSessionId;

      if (!dbSessionId) {
        return;
      }

      await prisma.userSession.updateMany({
        where: {
          id: dbSessionId,
          logoutAt: null,
        },
        data: { logoutAt: new Date() },
      });
    },
  },
});
