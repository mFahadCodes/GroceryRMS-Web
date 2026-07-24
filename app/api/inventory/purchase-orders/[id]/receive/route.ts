import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { receivePurchaseOrder } from "@/lib/services/inventory-service";
import { receivePurchaseOrderSchema } from "@/lib/validators/inventory.validators";
import { ServiceError } from "@/lib/api/service-error";

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
  // SEC-05B: the RECEIVE_PURCHASE_ORDER audit is transaction-required and
  // written inside the service transaction.
  try {
    const updated = await receivePurchaseOrder(
      purchaseOrderId,
      parsed.data.items.map((row) => ({
        itemId: row.purchaseOrderItemId,
        quantityReceived: row.receivedQty,
      })),
      auth.session.user.id,
      resolveClientIp(request),
    );
    return ok(updated);
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail(
      "Failed to receive purchase order",
      "RECEIVE_PURCHASE_ORDER_FAILED",
      500,
    );
  }
}
