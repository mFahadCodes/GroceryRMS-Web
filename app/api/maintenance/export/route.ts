import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { getSqliteFilePath } from "@/lib/services/maintenance-service";

export async function POST(_request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 5);
  if (auth.error) return auth.error;

  const dbPath = getSqliteFilePath();
  const tempPath = path.join(
    os.tmpdir(),
    `GroceryRMS-export-${Date.now()}.db`,
  );

  const source = new Database(dbPath, { readonly: true });
  source.backup(tempPath);
  source.close();

  const buffer = fs.readFileSync(tempPath);
  fs.unlinkSync(tempPath);

  const fileName = `GroceryRMS-export-${new Date().toISOString().slice(0, 10)}.db`;
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
