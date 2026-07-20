import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { restoreDatabase } from "@/lib/services/maintenance-service";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 5);
  if (auth.error) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file");
  const confirmText = formData.get("confirmText");

  if (confirmText !== "RESTORE") {
    return fail(
      'Confirmation required: set confirmText to "RESTORE"',
      "CONFIRMATION_REQUIRED",
      400,
    );
  }

  if (!(file instanceof File)) {
    return fail("Database file is required", "FILE_REQUIRED", 400);
  }

  const tempPath = path.join(os.tmpdir(), `restore-${Date.now()}.db`);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  try {
    const result = await restoreDatabase(tempPath);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DB_RESTORE",
      tableName: "database",
      newValues: { fileName: file.name },
    });
    return Response.json({ success: true, data: result });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Restore failed",
      "RESTORE_FAILED",
      400,
    );
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}
