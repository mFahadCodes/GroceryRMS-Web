import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getAllSettingsGrouped } from "@/lib/services/settings-service";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 1);
  if (auth.error) return auth.error;
  const grouped = await getAllSettingsGrouped();
  return ok(serializeRecord(grouped));
}
