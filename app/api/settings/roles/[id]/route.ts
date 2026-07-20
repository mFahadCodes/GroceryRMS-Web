import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { deleteRole } from "@/lib/services/settings-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const roleId = Number.parseInt(id, 10);
  if (Number.isNaN(roleId)) return fail("Invalid role id", "INVALID_ID", 400);

  try {
    const deleted = await deleteRole(roleId);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_ROLE",
      tableName: "roles",
      recordId: roleId,
    });
    return ok(deleted);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete role",
      "DELETE_ROLE_FAILED",
      400,
    );
  }
}
