import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, paginated } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getProductStockMovements } from "@/lib/services/product-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  const page = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const result = await getProductStockMovements(productId, page, limit);
  return paginated(serializeRecord(result.items), result.total, result.page, result.limit);
}
