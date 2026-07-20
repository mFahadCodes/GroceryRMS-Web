import type { NextAuthConfig, Session } from "next-auth";
import { getIdleTimeoutMinutes } from "@/lib/idle-timeout";
import { prisma } from "@/lib/prisma";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/security/auth-constants";
import {
  createPrismaAuthoritativeSessionRepository,
} from "@/lib/security/authoritative-session";
import { updateAuthoritativeJwt } from "@/lib/security/auth-jwt";

const PUBLIC_PATHS = ["/login"];
const authoritativeSessions = createPrismaAuthoritativeSessionRepository(prisma);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/settings/store";
}

function isAuthApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth");
}

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const pathname = nextUrl.pathname;

      if (isAuthApiPath(pathname)) {
        return true;
      }

      if (isPublicApiPath(pathname)) {
        return true;
      }

      if (auth?.expired) {
        const loginUrl = new URL("/login", nextUrl);
        loginUrl.searchParams.set("reason", "timeout");
        return Response.redirect(loginUrl);
      }

      const isLoggedIn = Boolean(auth?.user);

      if (isPublicPath(pathname)) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/pos", nextUrl));
        }
        return true;
      }

      return isLoggedIn;
    },
    async jwt({ token, user }) {
      return updateAuthoritativeJwt(
        { token, user },
        {
          repository: authoritativeSessions,
          getIdleTimeoutMinutes,
        },
      );
    },
    session({ session, token }) {
      if (token.expired) {
        session.expired = true;
        return session;
      }

      session.expired = false;
      const user = session.user as Session["user"];
      user.id =
        typeof token.id === "number" ? token.id : Number(token.id ?? 0);
      user.roleId =
        typeof token.roleId === "number"
          ? token.roleId
          : Number(token.roleId ?? 0);
      user.permissions = Array.isArray(token.permissions)
        ? token.permissions
        : [];
      return session;
    },
  },
} satisfies NextAuthConfig;
