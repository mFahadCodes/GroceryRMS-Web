import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { payPayroll } from "@/lib/services/payroll-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.GENERATE_PAYROLL, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const payrollId = Number.parseInt(id, 10);
  if (Number.isNaN(payrollId)) return fail("Invalid payroll id", "INVALID_ID", 400);
  const row = await payPayroll(payrollId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "PAY_PAYROLL",
    tableName: "payrolls",
    recordId: payrollId,
    newValues: { status: "Paid" },
  });
  return ok(row);
}
