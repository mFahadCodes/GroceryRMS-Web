import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  addItemToOrder,
  calculateTotals,
  getOrderById,
} from "@/lib/services/order-service";
import { addOrderItemBodySchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = addOrderItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    await addItemToOrder({
      orderId,
      productId: parsed.data.productId,
      scannedBarcode: parsed.data.scannedBarcode,
      variantId: parsed.data.variantId,
      quantity: parsed.data.quantity,
      weightKg: parsed.data.weightKg,
      notes: parsed.data.notes,
    });
    const updated = await calculateTotals(orderId);
    const order = await getOrderById(updated.id);

    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "ADD_ORDER_ITEM",
      tableName: "order_items",
      recordId: updated.id,
      newValues: parsed.data,
    });

    return ok(serializeRecord(order));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to add item",
      "ADD_ORDER_ITEM_FAILED",
      400,
    );
  }
}
