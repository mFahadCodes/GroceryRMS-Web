import { signOut } from "@/lib/auth";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { SESSION_REVOCATION_REASONS } from "@/lib/security/auth-constants";
import { readServerAuthToken } from "@/lib/security/auth-token";
import { revokeCurrentSession } from "@/lib/security/session-invalidation";

export async function POST(request: Request) {
  try {
    const token = await readServerAuthToken(request);
    if (typeof token?.sessionId === "string" && typeof token.id === "number") {
      await revokeCurrentSession(prisma, {
        sessionId: token.sessionId,
        userId: token.id,
        reason: SESSION_REVOCATION_REASONS.LOGOUT,
      });
    }

    await signOut({ redirect: false });
    return ok({ loggedOut: true });
  } catch {
    return fail(
      "Logout failed",
      "LOGOUT_FAILED",
      500,
    );
  }
}
