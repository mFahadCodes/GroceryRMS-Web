import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { fail } from "@/lib/api-response";
import type { Session } from "next-auth";
import { isPasswordRotationBlocked } from "@/lib/security/password-rotation";

type AuthResult =
  | { session: Session; error?: never }
  | { session?: never; error: ReturnType<typeof fail> };

export async function requireSession(
  options: { allowPasswordChangeRequired?: boolean } = {},
): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user || session.expired) {
    return { error: fail("Unauthorized", "UNAUTHORIZED", 401) };
  }
  if (
    isPasswordRotationBlocked(
      session.user.mustChangePassword,
      options.allowPasswordChangeRequired,
    )
  ) {
    return {
      error: fail(
        "Password change required",
        "PASSWORD_CHANGE_REQUIRED",
        403,
      ),
    };
  }
  return { session };
}

export async function requirePermission(
  permissionName: string,
  minimumLevel = 1,
): Promise<AuthResult> {
  const result = await requireSession();
  if (result.error) {
    return result;
  }
  if (
    !hasPermission(
      result.session.user.permissions,
      permissionName,
      minimumLevel,
    )
  ) {
    return { error: fail("Forbidden", "FORBIDDEN", 403) };
  }
  return result;
}
