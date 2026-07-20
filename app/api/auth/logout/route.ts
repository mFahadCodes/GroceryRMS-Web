import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";

export async function POST() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  try {
    await signOut({ redirect: false });
    return ok({ loggedOut: true });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Logout failed",
      "LOGOUT_FAILED",
      500,
    );
  }
}
