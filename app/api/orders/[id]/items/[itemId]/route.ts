import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  calculateTotals,
  getOrderById,
  removeOrderItem,
  updateItemQuantity,
} from "@/lib/services/order-service";
import { patchOrderItemBodySchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id, itemId } = await context.params;
  const orderId = Number.parseInt(id, 10);
  const orderItemId = Number.parseInt(itemId, 10);
  if (Number.isNaN(orderId) || Number.isNaN(orderItemId)) {
    return fail("Invalid ids", "INVALID_IDS", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = patchOrderItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    if (parsed.data.quantity !== undefined) {
      await updateItemQuantity(orderItemId, parsed.data.quantity);
    }
    if (parsed.data.voidReason !== undefined) {
      await removeOrderItem(orderItemId, parsed.data.voidReason);
    }
    const updated = await calculateTotals(orderId);
    const order = await getOrderById(updated.id);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "PATCH_ORDER_ITEM",
      tableName: "order_items",
      recordId: orderItemId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(order));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to patch order item",
      "PATCH_ORDER_ITEM_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id, itemId } = await context.params;
  const orderId = Number.parseInt(id, 10);
  const orderItemId = Number.parseInt(itemId, 10);
  if (Number.isNaN(orderId) || Number.isNaN(orderItemId)) {
    return fail("Invalid ids", "INVALID_IDS", 400);
  }

  try {
    await removeOrderItem(orderItemId, "Deleted from item route");
    const updated = await calculateTotals(orderId);
    const order = await getOrderById(updated.id);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_ORDER_ITEM",
      tableName: "order_items",
      recordId: orderItemId,
    });
    return ok(serializeRecord(order));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete order item",
      "DELETE_ORDER_ITEM_FAILED",
      400,
    );
  }
}
