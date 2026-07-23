import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { ManagerApprovalServiceError } from "@/lib/services/manager-approval-service";
import { applyOrderDiscount } from "@/lib/services/order-service";
import { ServiceError } from "@/lib/api/service-error";
import {
  applyOrderDiscountBusinessSchema,
  applyOrderDiscountManagerApprovalTokenSchema,
} from "@/lib/validators/order.validators";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.APPLY_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  if (!auth.session.authoritative) {
    return fail(
      "Manager approval is unavailable",
      "MANAGER_APPROVAL_UNAVAILABLE",
      503,
    );
  }

  const keyParsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!keyParsed.ok) {
    return fail(keyParsed.message, keyParsed.code, 400);
  }

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const businessFields = extractDiscountBusinessFields(body);
  const businessParsed = applyOrderDiscountBusinessSchema.safeParse(businessFields);
  if (!businessParsed.success) {
    return fail(
      "Invalid request body",
      "VALIDATION_ERROR",
      400,
      businessParsed.error.flatten(),
    );
  }

  // Business DTO only — managerApprovalToken is never hashed or stored.
  const requestPayload = {
    orderId,
    discountAmount: businessParsed.data.discountAmount ?? null,
    discountPercent: businessParsed.data.discountPercent ?? null,
    reason: businessParsed.data.reason ?? null,
  };

  try {
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.discount",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative.terminalId,
      requestPayload,
      execute: async (tx) => {
        // Original execution only — matching replay never enters execute.
        const tokenParsed = applyOrderDiscountManagerApprovalTokenSchema.safeParse(
          extractManagerApprovalToken(body),
        );
        if (!tokenParsed.success) {
          throw new ServiceError(
            "Manager approval token is required",
            "VALIDATION_ERROR",
            400,
          );
        }

        const updated = await applyOrderDiscount(
          {
            orderId,
            discountAmount: businessParsed.data.discountAmount,
            discountPercent: businessParsed.data.discountPercent,
            reason: businessParsed.data.reason,
            approvalToken: tokenParsed.data,
            requester: {
              userId: auth.session.user.id,
              sessionId: auth.session.authoritative!.sessionId,
              authVersion: auth.session.authoritative!.authVersion,
              terminalId: auth.session.authoritative!.terminalId,
              permissions: auth.session.user.permissions,
            },
            auditIpAddress: resolveClientIp(request),
          },
          tx,
        );
        return { status: 200, body: serializeRecord(updated) };
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
    if (error instanceof ManagerApprovalServiceError) {
      return fail(
        approvalErrorMessage(error.code),
        error.code,
        error.status,
      );
    }
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail(
      error instanceof Error ? error.message : "Failed to apply discount",
      "APPLY_DISCOUNT_FAILED",
      400,
    );
  }
}

function extractDiscountBusinessFields(body: unknown): {
  discountAmount?: unknown;
  discountPercent?: unknown;
  reason?: unknown;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    discountAmount: record.discountAmount,
    discountPercent: record.discountPercent,
    reason: record.reason,
  };
}

function extractManagerApprovalToken(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  return (body as Record<string, unknown>).managerApprovalToken;
}

function approvalErrorMessage(code: ManagerApprovalServiceError["code"]) {
  if (code === "MANAGER_APPROVAL_EXPIRED") {
    return "Manager approval expired";
  }
  if (code === "MANAGER_APPROVAL_ALREADY_USED") {
    return "Manager approval already used";
  }
  return "Manager approval invalid";
}
