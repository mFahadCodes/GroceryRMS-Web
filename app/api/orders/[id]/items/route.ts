import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ServiceError } from "@/lib/api/service-error";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import { addItemToOrder } from "@/lib/services/order-service";
import { addOrderItemBodySchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!keyParsed.ok) {
    return fail(keyParsed.message, keyParsed.code, 400);
  }

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = addOrderItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const requestPayload = {
    orderId,
    productId: parsed.data.productId ?? null,
    scannedBarcode: parsed.data.scannedBarcode ?? null,
    variantId: parsed.data.variantId ?? null,
    quantity: parsed.data.quantity,
    weightKg: parsed.data.weightKg ?? null,
    notes: parsed.data.notes ?? null,
  };

  try {
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.add-item",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative?.terminalId ?? null,
      requestPayload,
      execute: async (tx) => {
        const order = await addItemToOrder(
          {
            orderId,
            productId: parsed.data.productId,
            scannedBarcode: parsed.data.scannedBarcode,
            variantId: parsed.data.variantId,
            quantity: parsed.data.quantity,
            weightKg: parsed.data.weightKg,
            notes: parsed.data.notes,
            userId: auth.session.user.id,
            auditIpAddress: resolveClientIp(request),
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    if (result.replayed) {
      return okFromStoredEnvelope(result.responseBody, result.status, {
        "Idempotency-Replayed": "true",
      });
    }
    return ok(result.body, result.status, { "Idempotency-Replayed": "false" });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return fail(error.message, error.code, 409);
    }
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail("Failed to add item", "ADD_ORDER_ITEM_FAILED", 400);
  }
}
