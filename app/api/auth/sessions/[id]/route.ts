import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ServiceError } from "@/lib/api/service-error";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { buildSessionForceLogoutAuditMetadata } from "@/lib/security/audit-metadata";
import { forceLogoutSession } from "@/lib/services/session-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 5);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const sessionId = Number.parseInt(id, 10);
  if (Number.isNaN(sessionId)) return fail("Invalid session id", "INVALID_ID", 400);

  try {
    const session = await forceLogoutSession(sessionId);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "FORCE_LOGOUT",
      tableName: "user_sessions",
      recordId: sessionId,
      newValues: buildSessionForceLogoutAuditMetadata({
        userId: session.userId,
        username: session.user.username,
      }),
    });
    return ok(serializeRecord(session));
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail(
      "Failed to force logout session",
      "FORCE_LOGOUT_FAILED",
      500,
    );
  }
}
