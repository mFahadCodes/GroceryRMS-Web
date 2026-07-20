import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getCustomerSummary } from "@/lib/services/customer-service";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_REPORTS, 1);
  if (auth.error) return auth.error;
  const summary = await getCustomerSummary();
  return ok(serializeRecord(summary));
}
