import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
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
    updated = await updateUser(userId, parsed.data, {
      actorUserId: auth.session.user.id,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to update user", "UPDATE_USER_FAILED", 500);
  }
  const auditValues = {
    ...(parsed.data.username !== undefined ? { username: parsed.data.username } : {}),
    ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}),
    ...(parsed.data.roleId !== undefined ? { roleId: parsed.data.roleId } : {}),
    ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
    ...(parsed.data.isActive !== undefined
      ? { isActive: parsed.data.isActive }
      : {}),
    ...(parsed.data.password !== undefined ? { passwordChanged: true } : {}),
    ...(parsed.data.pin !== undefined ? { pinChanged: true } : {}),
  };
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_USER",
    tableName: "users",
    recordId: userId,
    newValues: auditValues,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const userId = Number.parseInt(id, 10);
  if (Number.isNaN(userId)) return fail("Invalid user id", "INVALID_ID", 400);
  const deleted = await deleteUser(userId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_USER",
    tableName: "users",
    recordId: userId,
  });
  return ok(deleted);
}
