import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { listEmployees, createEmployee } from "@/lib/services/employee-service";
import { createEmployeeSchema } from "@/lib/validators/hr.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_EMPLOYEES, 1);
  if (auth.error) return auth.error;
  return ok(await listEmployees());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_EMPLOYEES, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createEmployee({
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    cnic: parsed.data.cnic,
    address: parsed.data.address,
    emergencyContact: parsed.data.emergencyContact,
    category: parsed.data.category,
    employmentType: parsed.data.employmentType,
    designation: parsed.data.designation,
    joiningDate: parsed.data.joiningDate
      ? new Date(parsed.data.joiningDate)
      : undefined,
    basicSalary: parsed.data.basicSalary,
    allowances: parsed.data.allowances,
    deductions: parsed.data.deductions,
    userId: parsed.data.userId,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_EMPLOYEE",
    tableName: "employees",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
