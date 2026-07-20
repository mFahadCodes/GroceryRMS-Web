import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { getEmployeeById, updateEmployee, deleteEmployee } from "@/lib/services/employee-service";
import { updateEmployeeSchema } from "@/lib/validators/hr.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EMPLOYEES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const employeeId = Number.parseInt(id, 10);
  if (Number.isNaN(employeeId)) return fail("Invalid employee id", "INVALID_ID", 400);
  const employee = await getEmployeeById(employeeId);
  if (!employee) return fail("Employee not found", "EMPLOYEE_NOT_FOUND", 404);
  return ok(employee);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EMPLOYEES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const employeeId = Number.parseInt(id, 10);
  if (Number.isNaN(employeeId)) return fail("Invalid employee id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await updateEmployee(employeeId, {
    ...parsed.data,
    joiningDate: parsed.data.joiningDate
      ? new Date(parsed.data.joiningDate)
      : undefined,
    leavingDate:
      parsed.data.leavingDate !== undefined
        ? parsed.data.leavingDate
          ? new Date(parsed.data.leavingDate)
          : null
        : undefined,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_EMPLOYEE",
    tableName: "employees",
    recordId: employeeId,
    newValues: parsed.data,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EMPLOYEES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const employeeId = Number.parseInt(id, 10);
  if (Number.isNaN(employeeId)) return fail("Invalid employee id", "INVALID_ID", 400);
  const deleted = await deleteEmployee(employeeId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_EMPLOYEE",
    tableName: "employees",
    recordId: employeeId,
  });
  return ok(deleted);
}
