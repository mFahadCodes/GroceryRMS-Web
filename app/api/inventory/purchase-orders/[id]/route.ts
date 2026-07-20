import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getPurchaseOrderById } from "@/lib/services/inventory-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const poId = Number.parseInt(id, 10);
  if (Number.isNaN(poId)) return fail("Invalid purchase order id", "INVALID_ID", 400);

  const po = await getPurchaseOrderById(poId);
  if (!po) return fail("Purchase order not found", "PO_NOT_FOUND", 404);
  return ok(serializeRecord(po));
}
