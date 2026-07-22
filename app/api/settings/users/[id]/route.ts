import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { getUserById, updateUser, deleteUser } from "@/lib/services/settings-service";
import { updateUserSchema } from "@/lib/validators/settings.validators";
import { ServiceError } from "@/lib/api/service-error";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const userId = Number.parseInt(id, 10);
  if (Number.isNaN(userId)) return fail("Invalid user id", "INVALID_ID", 400);

  const user = await getUserById(userId);
  if (!user) return fail("User not found", "USER_NOT_FOUND", 404);
  return ok(user);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const userId = Number.parseInt(id, 10);
  if (Number.isNaN(userId)) return fail("Invalid user id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  let updated;
  try {
    // SEC-05B: the UPDATE_USER audit is transaction-required and written
    // inside the service transaction with field names only.
    updated = await updateUser(userId, parsed.data, {
      actorUserId: auth.session.user.id,
      ipAddress: resolveClientIp(request),
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to update user", "UPDATE_USER_FAILED", 500);
  }
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const userId = Number.parseInt(id, 10);
  if (Number.isNaN(userId)) return fail("Invalid user id", "INVALID_ID", 400);
  // SEC-05B: the DELETE_USER audit is transaction-required and written
  // inside the service transaction.
  const deleted = await deleteUser(userId, {
    actorUserId: auth.session.user.id,
    ipAddress: resolveClientIp(request),
  });
  return ok(deleted);
}
