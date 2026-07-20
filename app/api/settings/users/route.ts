import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { listUsers, createUser } from "@/lib/services/settings-service";
import { createUserSchema } from "@/lib/validators/settings.validators";
import { ServiceError } from "@/lib/api/service-error";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  return ok(await listUsers());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  let created;
  try {
    created = await createUser(parsed.data, {
      actorUserId: auth.session.user.id,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to create user", "CREATE_USER_FAILED", 500);
  }
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_USER",
    tableName: "users",
    recordId: created.id,
    newValues: { username: parsed.data.username, roleId: parsed.data.roleId },
  });
  return ok(created, 201);
}
