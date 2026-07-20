import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import { getPayrollById, updatePayroll } from "@/lib/services/payroll-service";
import { payrollUpdateSchema } from "@/lib/validators/hr.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.GENERATE_PAYROLL, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const payrollId = Number.parseInt(id, 10);
  if (Number.isNaN(payrollId)) return fail("Invalid payroll id", "INVALID_ID", 400);

  const payroll = await getPayrollById(payrollId);
  if (!payroll) return fail("Payroll not found", "PAYROLL_NOT_FOUND", 404);
  return ok(serializeRecord(payroll));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.GENERATE_PAYROLL, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const payrollId = Number.parseInt(id, 10);
  if (Number.isNaN(payrollId)) return fail("Invalid payroll id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = payrollUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await updatePayroll(payrollId, parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_PAYROLL",
      tableName: "payrolls",
      recordId: payrollId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update payroll",
      "UPDATE_PAYROLL_FAILED",
      400,
    );
  }
}
