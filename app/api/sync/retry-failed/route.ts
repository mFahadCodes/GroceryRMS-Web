import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { retryFailedSync } from "@/lib/sync-worker";

export async function POST(_request: NextRequest) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 1);
  if (auth.error) return auth.error;
  return ok(await retryFailedSync());
}
