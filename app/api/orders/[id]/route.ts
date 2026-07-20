import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  addItemToOrder,
  applyOrderDiscount,
  calculateTotals,
  getOrderById,
  holdOrder,
  recallOrder,
  removeOrderItem,
  updateItemQuantity,
  voidOrder,
} from "@/lib/services/order-service";
import { modifyOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

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

  const body = await parseJsonBody<unknown>(request);
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
        const normalizedNotes = parsed.data.notes?.trim().toLowerCase();
        if (normalizedNotes === "hold") {
          await holdOrder(orderId);
          break;
        }
        if (normalizedNotes === "recall") {
          await recallOrder(orderId);
          break;
        }
        if (normalizedNotes?.startsWith("void:")) {
          await voidOrder({
            orderId,
            reason: parsed.data.notes?.slice(5).trim() || "Voided from updateMeta",
            approvedByUserId: auth.session.user.id,
          });
          break;
        }

        await prisma.order.update({
          where: { id: orderId },
          data: {
            ...(parsed.data.notes !== undefined
              ? { notes: parsed.data.notes }
              : {}),
            ...(parsed.data.customerId !== undefined
              ? { customerId: parsed.data.customerId }
              : {}),
            ...(parsed.data.discountAmount !== undefined
              ? { discountAmount: parsed.data.discountAmount }
              : {}),
            ...(parsed.data.adjustment !== undefined
              ? { adjustment: parsed.data.adjustment }
              : {}),
          },
        });
        if (
          parsed.data.discountPercent !== undefined ||
          parsed.data.taxPercent !== undefined
        ) {
          if (parsed.data.discountPercent !== undefined) {
            await applyOrderDiscount({
              orderId,
              discountPercent: parsed.data.discountPercent,
              approvedByUserId: auth.session.user.id,
            });
          } else {
            await calculateTotals(
              orderId,
              parsed.data.discountPercent ?? 0,
              parsed.data.taxPercent ?? 0,
            );
          }
        }
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
