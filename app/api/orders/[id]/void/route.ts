import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { ManagerApprovalServiceError } from "@/lib/services/manager-approval-service";
import { voidOrder } from "@/lib/services/order-service";
import { ServiceError } from "@/lib/api/service-error";
import { voidOrderSchema } from "@/lib/validators/order.validators";
import { resolveClientIp } from "@/lib/client-ip";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.VOID_ORDERS, 1);
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
  const parsed = voidOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  // Business DTO only — managerApprovalToken is an execution credential, not payload.
  const requestPayload = {
    orderId,
    reason: parsed.data.reason,
    reverseStock: parsed.data.reverseStock ?? false,
  };

  try {
    const result = await executeFinancialIdempotent({
      rawKey: keyParsed.key,
      operation: "order.void",
      resourceType: "orders",
      resourceId: orderId,
      actorUserId: auth.session.user.id,
      authoritativeTerminalId: auth.session.authoritative.terminalId,
      requestPayload,
      execute: async (tx) => {
        const voided = await voidOrder(
          {
            orderId,
            reason: parsed.data.reason,
            approvalToken: parsed.data.managerApprovalToken,
            requester: {
              userId: auth.session.user.id,
              sessionId: auth.session.authoritative!.sessionId,
              authVersion: auth.session.authoritative!.authVersion,
              terminalId: auth.session.authoritative!.terminalId,
              permissions: auth.session.user.permissions,
            },
            reverseStock: parsed.data.reverseStock ?? false,
            auditIpAddress: resolveClientIp(request),
          },
          tx,
        );
        return { status: 200, body: serializeRecord(voided) };
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
      error instanceof Error ? error.message : "Failed to void order",
      "VOID_ORDER_FAILED",
      400,
    );
  }
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
