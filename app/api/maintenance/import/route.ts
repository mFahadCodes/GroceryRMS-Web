import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { smartImportDatabase } from "@/lib/services/maintenance-service";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 5);
  if (auth.error) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail("Database file is required", "FILE_REQUIRED", 400);
  }

  const tempPath = path.join(os.tmpdir(), `import-${Date.now()}.db`);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  try {
    const result = await smartImportDatabase(tempPath);
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Import failed",
      "IMPORT_FAILED",
      400,
    );
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}
