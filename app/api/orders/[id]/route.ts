import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
import {
  addItemToOrder,
  calculateTotals,
  getOrderById,
  removeOrderItem,
  updateItemQuantity,
  updateOrderMetadata,
} from "@/lib/services/order-service";
import { modifyOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * SEC-04A: bound the generic modify body so oversized payloads are rejected
 * before validation. Item and metadata updates are small; 16 KiB is generous.
 */
const MAX_MODIFY_ORDER_REQUEST_BYTES = 16 * 1024;

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const order = await getOrderById(orderId);
  if (!order) return fail("Order not found", "ORDER_NOT_FOUND", 404);

  return ok(serializeRecord(order));
}

/**
 * Generic order modification. SEC-04A restricts this route to level-1-safe
 * operations only: item edits (permission parity with the dedicated item
 * routes) and a strict metadata allowlist (`notes`, `customerId`).
 *
 * This route must never dispatch privileged business actions. Discounts,
 * voids, holds, recalls, status transitions, payments, tax, and adjustments
 * have dedicated endpoints with their own permission and manager-approval
 * requirements; note text is stored verbatim and is never interpreted as a
 * command. See docs/security/order-generic-update-boundary.md.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const order = await getOrderById(orderId);
  if (!order) return fail("Order not found", "ORDER_NOT_FOUND", 404);
  if (order.status !== "Open") {
    return fail("Only open orders can be modified", "ORDER_NOT_OPEN", 400);
  }

  const body = await readBoundedJson(request);
  const parsed = modifyOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    switch (parsed.data.action) {
      case "addItem": {
        await addItemToOrder({
          orderId,
          productId: parsed.data.productId,
          variantId: parsed.data.variantId,
          quantity: parsed.data.quantity,
          weightKg: parsed.data.weightKg,
          notes: parsed.data.notes,
          scannedBarcode: parsed.data.scannedBarcode,
        });
        await calculateTotals(orderId);
        await auditFromRequest(request, {
          userId: auth.session.user.id,
          action: "ADD_ORDER_ITEM",
          tableName: "order_items",
          recordId: orderId,
          newValues: parsed.data,
        });
        break;
      }
      case "updateItem": {
        await updateItemQuantity(
          parsed.data.orderItemId,
          parsed.data.quantity,
        );
        await calculateTotals(orderId);
        await auditFromRequest(request, {
          userId: auth.session.user.id,
          action: "UPDATE_ORDER_ITEM",
          tableName: "order_items",
          recordId: parsed.data.orderItemId,
          newValues: parsed.data,
        });
        break;
      }
      case "removeItem": {
        await removeOrderItem(
          parsed.data.orderItemId,
          parsed.data.voidReason,
        );
        await calculateTotals(orderId);
        await auditFromRequest(request, {
          userId: auth.session.user.id,
          action: "VOID_ORDER_ITEM",
          tableName: "order_items",
          recordId: parsed.data.orderItemId,
          newValues: parsed.data,
        });
        break;
      }
      case "updateMeta": {
        await updateOrderMetadata(orderId, {
          notes: parsed.data.notes,
          customerId: parsed.data.customerId,
        });
        await auditFromRequest(request, {
          userId: auth.session.user.id,
          action: "UPDATE_ORDER_META",
          tableName: "orders",
          recordId: orderId,
          newValues: parsed.data,
        });
        break;
      }
    }

    const updated = await getOrderById(orderId);
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to modify order",
      "MODIFY_ORDER_FAILED",
      400,
    );
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_MODIFY_ORDER_REQUEST_BYTES
  ) {
    return null;
  }
  try {
    const text = await request.text();
    if (
      new TextEncoder().encode(text).byteLength > MAX_MODIFY_ORDER_REQUEST_BYTES
    ) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
