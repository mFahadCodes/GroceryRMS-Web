import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
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
    // SEC-05B: the CREATE_USER audit is transaction-required and written
    // inside the service transaction.
    created = await createUser(parsed.data, {
      actorUserId: auth.session.user.id,
      ipAddress: resolveClientIp(request),
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to create user", "CREATE_USER_FAILED", 500);
  }
  return ok(created, 201);
}
