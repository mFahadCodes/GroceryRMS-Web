import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, paginated } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { searchOrders } from "@/lib/services/order-service";
import { orderSearchQuerySchema } from "@/lib/validators/order.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const parsed = orderSearchQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const result = await searchOrders(parsed.data);
  return paginated(
    serializeRecord(result.items),
    result.total,
    result.page,
    result.pageSize,
  );
}
