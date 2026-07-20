import { NextRequest } from "next/server";
import { toLocalDateString } from "@/lib/date-range";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getProfitLoss } from "@/lib/services/report-service";
import { reportDateRangeQuerySchema } from "@/lib/validators/report.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_REPORTS, 1);
  if (auth.error) return auth.error;
  const parsed = reportDateRangeQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const from = parsed.data.from ?? toLocalDateString(new Date());
  const to = parsed.data.to ?? from;
  const report = await getProfitLoss(from, to);
  return ok(serializeRecord(report));
}
