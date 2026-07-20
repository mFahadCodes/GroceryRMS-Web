import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { getServiceErrorMessage } from "@/lib/api/service-error";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  addCustomerAddress,
  listCustomerAddresses,
} from "@/lib/services/customer-service";
import { createCustomerAddressSchema } from "@/lib/validators/customer.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);
  return ok(await listCustomerAddresses(customerId));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = createCustomerAddressSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  try {
    const address = await addCustomerAddress({
      customerId,
      label: parsed.data.label,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2,
      city: parsed.data.city,
      area: parsed.data.area,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      isDefault: parsed.data.isDefault,
    });
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "ADD_CUSTOMER_ADDRESS",
      tableName: "customer_addresses",
      recordId: address.id,
      newValues: parsed.data,
    });
    return ok(address, 201);
  } catch (error) {
    return fail(
      getServiceErrorMessage(error, "Failed to add address"),
      "ADD_ADDRESS_FAILED",
      400,
    );
  }
}
