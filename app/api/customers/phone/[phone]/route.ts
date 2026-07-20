import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getCustomerByPhone } from "@/lib/services/customer-service";

type RouteContext = { params: Promise<{ phone: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;
  const { phone } = await context.params;
  const customer = await getCustomerByPhone(phone);
  if (!customer) return fail("Customer not found", "CUSTOMER_NOT_FOUND", 404);
  return ok(serializeRecord(customer));
}
