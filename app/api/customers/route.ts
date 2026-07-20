import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createCustomer,
  getCustomerByPhone,
  listCustomers,
} from "@/lib/services/customer-service";
import {
  createCustomerSchema,
  customerQuerySchema,
} from "@/lib/validators/customer.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;

  const hasExplicitLimit = request.nextUrl.searchParams.has("limit");
  const parsed = customerQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const searchTerm = parsed.data.search ?? parsed.data.q;
  const query = {
    ...parsed.data,
    q: searchTerm,
    limit:
      searchTerm && !hasExplicitLimit
        ? Math.min(parsed.data.limit, 10)
        : parsed.data.limit,
  };

  if (parsed.data.phone) {
    const customer = await getCustomerByPhone(parsed.data.phone);
    if (!customer) return fail("Customer not found", "CUSTOMER_NOT_FOUND", 404);
    return ok(serializeRecord(customer));
  }

  const result = await listCustomers(query);
  return ok({
    ...result,
    items: serializeRecord(result.items),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const customer = await createCustomer(parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "CREATE_CUSTOMER",
      tableName: "customers",
      recordId: customer.id,
      newValues: parsed.data,
    });
    return ok(serializeRecord(customer), 201);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to create customer",
      "CREATE_CUSTOMER_FAILED",
      400,
    );
  }
}
