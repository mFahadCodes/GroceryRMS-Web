import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { receivePurchaseOrder } from "@/lib/services/inventory-service";
import { receivePurchaseOrderSchema } from "@/lib/validators/inventory.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const purchaseOrderId = Number.parseInt(id, 10);
  if (Number.isNaN(purchaseOrderId)) return fail("Invalid purchase order id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = receivePurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await receivePurchaseOrder(
    purchaseOrderId,
    parsed.data.items.map((row) => ({
      itemId: row.purchaseOrderItemId,
      quantityReceived: row.receivedQty,
    })),
    auth.session.user.id,
  );
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "RECEIVE_PURCHASE_ORDER",
    tableName: "purchase_orders",
    recordId: purchaseOrderId,
    newValues: parsed.data.items,
  });
  return ok(updated);
}
