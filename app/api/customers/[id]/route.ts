import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  getCustomerById,
  softDeleteCustomer,
  updateCustomer,
} from "@/lib/services/customer-service";
import { updateCustomerSchema } from "@/lib/validators/customer.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);

  const customer = await getCustomerById(customerId);
  if (!customer) return fail("Customer not found", "CUSTOMER_NOT_FOUND", 404);

  return ok(serializeRecord(customer));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const customer = await updateCustomer(customerId, parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_CUSTOMER",
      tableName: "customers",
      recordId: customerId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(customer));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update customer",
      "UPDATE_CUSTOMER_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);

  const customer = await softDeleteCustomer(customerId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_CUSTOMER",
    tableName: "customers",
    recordId: customerId,
  });
  return ok(serializeRecord(customer));
}
