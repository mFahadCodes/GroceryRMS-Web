import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { getStockTakeById } from "@/lib/services/inventory-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const stockTakeId = Number.parseInt(id, 10);
  if (Number.isNaN(stockTakeId)) return fail("Invalid stock take id", "INVALID_ID", 400);

  const stockTake = await getStockTakeById(stockTakeId);
  if (!stockTake) return fail("Stock take not found", "STOCK_TAKE_NOT_FOUND", 404);

  return ok(serializeRecord(stockTake));
}
