import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { restoreDatabaseFromBackupFile } from "@/lib/services/maintenance-service";
import { restoreFileSchema } from "@/lib/validators/maintenance.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 5);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = restoreFileSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const result = await restoreDatabaseFromBackupFile(parsed.data.filename);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DB_RESTORE_FROM_LIST",
      tableName: "database",
      newValues: { filename: parsed.data.filename },
    });
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Restore failed",
      "RESTORE_FAILED",
      400,
    );
  }
}
