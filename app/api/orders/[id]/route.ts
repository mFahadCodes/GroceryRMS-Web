import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ServiceError } from "@/lib/api/service-error";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
import { resolveClientIp } from "@/lib/client-ip";
import { buildOrderMetadataUpdateAuditMetadata } from "@/lib/security/audit-metadata";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import {
  addItemToOrder,
  getOrderById,
  orderInclude,
  removeOrderItem,
  updateItemQuantity,
  updateOrderMetadata,
} from "@/lib/services/order-service";
import { modifyOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

const putOrderResponseInclude = {
  ...orderInclude,
  orderItems: {
    include: { product: true, variant: true },
  },
  loyaltyTransactions: true,
  driver: { select: { id: true, name: true, phone: true } },
} as const;

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

  const audit = {
    userId: auth.session.user.id,
    auditIpAddress: resolveClientIp(request),
  };
  const terminalId = auth.session.authoritative?.terminalId ?? null;

  try {
    switch (parsed.data.action) {
      case "addItem": {
        const addItem = parsed.data;
        if (addItem.action !== "addItem") break;

        const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
        if (!keyParsed.ok) {
          return fail(keyParsed.message, keyParsed.code, 400);
        }

        const requestPayload = {
          orderId,
          productId: addItem.productId ?? null,
          variantId: addItem.variantId ?? null,
          quantity: addItem.quantity,
          weightKg: addItem.weightKg ?? null,
          notes: addItem.notes ?? null,
          scannedBarcode: addItem.scannedBarcode ?? null,
        };

        const result = await executeFinancialIdempotent({
          rawKey: keyParsed.key,
          operation: "order.add-item",
          resourceType: "orders",
          resourceId: orderId,
          actorUserId: auth.session.user.id,
          authoritativeTerminalId: terminalId,
          requestPayload,
          execute: async (tx) => {
            await addItemToOrder(
              {
                orderId,
                productId: addItem.productId,
                variantId: addItem.variantId,
                quantity: addItem.quantity,
                weightKg: addItem.weightKg,
                notes: addItem.notes,
                scannedBarcode: addItem.scannedBarcode,
                ...audit,
              },
              tx,
            );
            const updated = await tx.order.findUniqueOrThrow({
              where: { id: orderId },
              include: putOrderResponseInclude,
            });
            return { status: 200, body: serializeRecord(updated) };
          },
        });

        if (result.replayed) {
          return okFromStoredEnvelope(result.responseBody, result.status, {
            "Idempotency-Replayed": "true",
          });
        }
        return ok(result.body, result.status, { "Idempotency-Replayed": "false" });
      }
      case "updateItem": {
        const updateItem = parsed.data;
        if (updateItem.action !== "updateItem") break;

        const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
        if (!keyParsed.ok) {
          return fail(keyParsed.message, keyParsed.code, 400);
        }

        const requestPayload = {
          orderId,
          orderItemId: updateItem.orderItemId,
          quantity: updateItem.quantity,
        };

        const result = await executeFinancialIdempotent({
          rawKey: keyParsed.key,
          operation: "order.update-item-quantity",
          resourceType: "orders",
          resourceId: orderId,
          actorUserId: auth.session.user.id,
          authoritativeTerminalId: terminalId,
          requestPayload,
          execute: async (tx) => {
            await updateItemQuantity(
              {
                orderId,
                orderItemId: updateItem.orderItemId,
                quantity: updateItem.quantity,
                ...audit,
                auditAction: "UPDATE_ORDER_ITEM",
              },
              tx,
            );
            const updated = await tx.order.findUniqueOrThrow({
              where: { id: orderId },
              include: putOrderResponseInclude,
            });
            return { status: 200, body: serializeRecord(updated) };
          },
        });

        if (result.replayed) {
          return okFromStoredEnvelope(result.responseBody, result.status, {
            "Idempotency-Replayed": "true",
          });
        }
        return ok(result.body, result.status, { "Idempotency-Replayed": "false" });
      }
      case "removeItem": {
        await removeOrderItem({
          orderId,
          orderItemId: parsed.data.orderItemId,
          voidReason: parsed.data.voidReason,
          ...audit,
          auditAction: "VOID_ORDER_ITEM",
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
          recordId: orderId,
          newValues: buildOrderMetadataUpdateAuditMetadata(parsed.data),
        });
        break;
      }
    }

    const updated = await getOrderById(orderId);
    return ok(serializeRecord(updated));
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return fail(error.message, error.code, 409);
    }
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
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
