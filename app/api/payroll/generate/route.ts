import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { generatePayrollRun } from "@/lib/services/payroll-service";
import { payrollGenerateSchema } from "@/lib/validators/hr.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.GENERATE_PAYROLL, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = payrollGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const rows = await generatePayrollRun(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "GENERATE_PAYROLL",
    tableName: "payrolls",
    newValues: parsed.data,
  });
  return ok(rows);
}
