import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getDriverPerformance } from "@/lib/services/report-service";
import { driverPerformanceQuerySchema } from "@/lib/validators/report.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_REPORTS, 1);
  if (auth.error) return auth.error;

  const parsed = driverPerformanceQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const rows = await getDriverPerformance(parsed.data.from, parsed.data.to);
  return ok(serializeRecord(rows));
}
