import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, paginated } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getAuditLogReport } from "@/lib/services/report-service";
import { auditLogQuerySchema } from "@/lib/validators/report.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_AUDIT_LOG, 1);
  if (auth.error) return auth.error;
  const parsed = auditLogQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const report = await getAuditLogReport(parsed.data.page, parsed.data.limit);
  return paginated(serializeRecord(report.items), report.total, report.page, report.limit);
}
