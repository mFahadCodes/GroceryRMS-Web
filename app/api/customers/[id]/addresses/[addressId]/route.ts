import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  deleteCustomerAddress,
  updateCustomerAddress,
} from "@/lib/services/customer-service";
import { updateCustomerAddressSchema } from "@/lib/validators/customer.validators";

type RouteContext = { params: Promise<{ id: string; addressId: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const { id, addressId } = await context.params;
  const customerId = Number.parseInt(id, 10);
  const addressIdNum = Number.parseInt(addressId, 10);
  if (Number.isNaN(customerId) || Number.isNaN(addressIdNum)) {
    return fail("Invalid id", "INVALID_ID", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateCustomerAddressSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await updateCustomerAddress(customerId, addressIdNum, parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_CUSTOMER_ADDRESS",
      tableName: "customer_addresses",
      recordId: addressIdNum,
      newValues: parsed.data,
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update address",
      "UPDATE_ADDRESS_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const { id, addressId } = await context.params;
  const customerId = Number.parseInt(id, 10);
  const addressIdNum = Number.parseInt(addressId, 10);
  if (Number.isNaN(customerId) || Number.isNaN(addressIdNum)) {
    return fail("Invalid id", "INVALID_ID", 400);
  }

  try {
    const result = await deleteCustomerAddress(customerId, addressIdNum);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_CUSTOMER_ADDRESS",
      tableName: "customer_addresses",
      recordId: addressIdNum,
    });
    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete address",
      "DELETE_ADDRESS_FAILED",
      400,
    );
  }
}
