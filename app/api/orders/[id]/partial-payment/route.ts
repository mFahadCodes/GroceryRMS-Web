import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/api/serialize";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import { applyPartialPayment } from "@/lib/services/order-service";
import { partialPaymentSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const perms = auth.session.user.permissions;
  if (
    !hasPermission(perms, PERMS.PROCESS_PAYMENTS, 1) &&
    !hasPermission(perms, PERMS.CREATE_ORDERS, 1)
  ) {
    return fail("Forbidden", "FORBIDDEN", 403);
  }

  const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!keyParsed.ok) {
    return fail(keyParsed.message, keyParsed.code, 400);
  }

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return fail("Invalid order id", "INVALID_ORDER_ID", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = partialPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const requestPayload = {
    orderId,
    paymentMethodId: parsed.data.paymentMethodId,
    amount: parsed.data.amount,
    referenceNo: parsed.data.referenceNo ?? null,
  };

  try {
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative?.terminalId ?? null,
      requestPayload,
      execute: async (tx) => {
        const paymentResult = await applyPartialPayment(
          {
            orderId,
            paymentMethodId: parsed.data.paymentMethodId,
            amount: parsed.data.amount,
            referenceNo: parsed.data.referenceNo,
            userId: auth.session.user.id,
            auditIpAddress: resolveClientIp(request),
          },
          tx,
        );
        return { status: 200, body: serializeRecord(paymentResult) };
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
    return fail(
      error instanceof Error ? error.message : "Partial payment failed",
      "PARTIAL_PAYMENT_FAILED",
      400,
    );
  }
}
