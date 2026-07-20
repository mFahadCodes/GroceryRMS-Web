import type { NextAuthConfig, Session } from "next-auth";
import { getIdleTimeoutMinutes, idleTimeoutMs } from "@/lib/idle-timeout";

const PUBLIC_PATHS = ["/login"];

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
      const now = Date.now();

      if (user) {
        token.id = Number(user.id);
        token.roleId = user.roleId;
        token.permissions = user.permissions;
        token.dbSessionId = user.dbSessionId;
        token.lastActivityAt = now;
        token.expired = false;
        return token;
      }

      const idleMinutes = await getIdleTimeoutMinutes();
      const lastActivity =
        typeof token.lastActivityAt === "number" ? token.lastActivityAt : now;

      if (now - lastActivity > idleTimeoutMs(idleMinutes)) {
        token.expired = true;
        return token;
      }

      token.lastActivityAt = now;
      token.expired = false;
      return token;
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
      user.dbSessionId =
        typeof token.dbSessionId === "number"
          ? token.dbSessionId
          : Number(token.dbSessionId ?? 0);
      return session;
    },
  },
} satisfies NextAuthConfig;
