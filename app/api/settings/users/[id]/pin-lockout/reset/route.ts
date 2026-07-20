import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resetUserPinLockout } from "@/lib/services/pin-security-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const userId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return fail("Invalid user id", "INVALID_ID", 400);
  }

  const result = await resetUserPinLockout({
    userId,
    actorUserId: auth.session.user.id,
  });
  if (!result.reset) return fail("User not found", "USER_NOT_FOUND", 404);
  return ok({ reset: true });
}
