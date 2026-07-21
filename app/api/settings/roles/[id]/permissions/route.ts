import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { replaceRolePermissions } from "@/lib/services/settings-service";
import { updateRolePermissionsSchema } from "@/lib/validators/settings.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const roleId = Number.parseInt(id, 10);
  if (Number.isNaN(roleId)) return fail("Invalid role id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateRolePermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  // SEC-05B: the REPLACE_ROLE_PERMISSIONS audit is transaction-required and
  // written inside the service transaction.
  const updated = await replaceRolePermissions(roleId, parsed.data.permissions, {
    actorUserId: auth.session.user.id,
    ipAddress: resolveClientIp(request),
  });
  return ok(updated);
}
