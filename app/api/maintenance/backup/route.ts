import { NextRequest } from "next/server";
import fs from "node:fs";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { accessAuditFromRequest } from "@/lib/audit";
import { createBackupFile } from "@/lib/services/maintenance-service";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 5);
  if (auth.error) return auth.error;

  const { filePath, fileName } = await createBackupFile();
  const buffer = fs.readFileSync(filePath);

  await accessAuditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DB_BACKUP",
    newValues: { fileName },
  });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
