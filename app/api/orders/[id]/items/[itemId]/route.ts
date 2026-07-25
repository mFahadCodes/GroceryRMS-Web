import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ServiceError } from "@/lib/api/service-error";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import {
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
    const audit = {
      userId: auth.session.user.id,
      auditIpAddress: resolveClientIp(request),
    };
    let order;
    if (parsed.data.quantity !== undefined) {
      order = await updateItemQuantity({
        orderId,
        orderItemId,
        quantity: parsed.data.quantity,
        ...audit,
        auditAction: "PATCH_ORDER_ITEM",
      });
    }
    if (parsed.data.voidReason !== undefined) {
      order = await removeOrderItem({
        orderId,
        orderItemId,
        voidReason: parsed.data.voidReason,
        ...audit,
        auditAction: "PATCH_ORDER_ITEM",
      });
    }
    if (!order) {
      return fail("Invalid request body", "VALIDATION_ERROR", 400);
    }
    return ok(serializeRecord(order));
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to patch order item", "PATCH_ORDER_ITEM_FAILED", 400);
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
    const order = await removeOrderItem({
      orderId,
      orderItemId,
      voidReason: "Deleted from item route",
      userId: auth.session.user.id,
      auditIpAddress: resolveClientIp(request),
      auditAction: "DELETE_ORDER_ITEM",
    });
    return ok(serializeRecord(order));
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to delete order item", "DELETE_ORDER_ITEM_FAILED", 400);
  }
}
