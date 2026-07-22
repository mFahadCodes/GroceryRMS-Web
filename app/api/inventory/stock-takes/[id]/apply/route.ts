import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { applyStockTake } from "@/lib/services/inventory-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const stockTakeId = Number.parseInt(id, 10);
  if (Number.isNaN(stockTakeId)) return fail("Invalid stock take id", "INVALID_ID", 400);
  const body = await parseJsonBody<{ items?: Array<{ itemId: number; countedQty: string | number }> }>(request);
  if (!body?.items?.length) return fail("Invalid request body", "VALIDATION_ERROR", 400);
  // SEC-05B: the APPLY_STOCK_TAKE audit is transaction-required and written
  // inside the service transaction.
  const applied = await applyStockTake(
    stockTakeId,
    body.items,
    auth.session.user.id,
    resolveClientIp(request),
  );
  return ok(applied);
}
