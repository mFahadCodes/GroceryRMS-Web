import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { ServiceError } from "@/lib/api/service-error";
import { hasPermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/api/serialize";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import { checkoutFast } from "@/lib/services/order-service";
import { checkoutSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const perms = auth.session.user.permissions;
  if (
    !hasPermission(perms, PERMS.PROCESS_PAYMENTS, 1) ||
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
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const paymentMethodId =
    parsed.data.paymentMethodId ??
    (parsed.data.payments && parsed.data.payments.length === 1
      ? parsed.data.payments[0].paymentMethodId
      : undefined);
  const tenderedAmount =
    parsed.data.tenderedAmount ??
    (parsed.data.payments && parsed.data.payments.length === 1
      ? parsed.data.payments[0].tenderedAmount ?? parsed.data.payments[0].amount
      : undefined);

  const requestPayload = {
    orderId,
    paymentMethodId: paymentMethodId ?? null,
    tenderedAmount: tenderedAmount ?? null,
    terminalId: parsed.data.terminalId,
    discountPercent: parsed.data.discountPercent,
    taxPercent: parsed.data.taxPercent,
    customerId: parsed.data.customerId ?? null,
    notes: parsed.data.notes ?? null,
    referenceNo: parsed.data.referenceNo ?? null,
    redeemPoints: parsed.data.redeemPoints,
    payments: parsed.data.payments ?? null,
  };

  try {
    // P0-A: full payment is created inside checkout — there is no separate
    // payment mutation route. Idempotency covers checkout + payments + stock.
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative?.terminalId ?? null,
      requestPayload,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId,
            paymentMethodId,
            tenderedAmount,
            terminalId: parsed.data.terminalId,
            cashierId: auth.session.user.id,
            discountPercent: parsed.data.discountPercent,
            taxPercent: parsed.data.taxPercent,
            customerId: parsed.data.customerId,
            notes: parsed.data.notes,
            referenceNo: parsed.data.referenceNo,
            redeemPoints: parsed.data.redeemPoints,
            payments: parsed.data.payments,
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
    return fail(
      error instanceof Error ? error.message : "Checkout failed",
      "CHECKOUT_FAILED",
      400,
    );
  }
}
