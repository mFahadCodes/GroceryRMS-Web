import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { ServiceError } from "@/lib/api/service-error";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import { refundOrder } from "@/lib/services/order-service";
import { refundOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.ISSUE_REFUNDS, 1);
  if (auth.error) return auth.error;

  const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!keyParsed.ok) {
    return fail(keyParsed.message, keyParsed.code, 400);
  }

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = refundOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const requestPayload = {
    orderId,
    reason: parsed.data.reason,
    amount: parsed.data.amount ?? null,
    paymentMethodId: parsed.data.paymentMethodId,
    terminalId: parsed.data.terminalId,
    referenceNo: parsed.data.referenceNo ?? null,
  };

  try {
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.refund",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative?.terminalId ?? null,
      requestPayload,
      execute: async (tx) => {
        const refundResult = await refundOrder(
          {
            orderId,
            reason: parsed.data.reason,
            amount: parsed.data.amount,
            paymentMethodId: parsed.data.paymentMethodId,
            terminalId: parsed.data.terminalId,
            cashierId: auth.session.user.id,
            referenceNo: parsed.data.referenceNo,
            auditIpAddress: resolveClientIp(request),
          },
          tx,
        );
        return { status: 200, body: serializeRecord(refundResult) };
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
    return fail(
      error instanceof Error ? error.message : "Failed to refund order",
      "REFUND_ORDER_FAILED",
      400,
    );
  }
}
