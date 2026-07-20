import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { listPayrolls } from "@/lib/services/payroll-service";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.GENERATE_PAYROLL, 1);
  if (auth.error) return auth.error;
  return ok(await listPayrolls());
}
