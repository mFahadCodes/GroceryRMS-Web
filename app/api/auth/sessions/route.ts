import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { ok } from "@/lib/api-response";
import { listActiveSessions } from "@/lib/services/session-service";

export async function GET() {
  const auth = await requirePermission(PERMS.MANAGE_USERS_ROLES, 5);
  if (auth.error) return auth.error;

  const sessions = await listActiveSessions();
  return ok(serializeRecord(sessions));
}
