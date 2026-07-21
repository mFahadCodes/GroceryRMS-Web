import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { ManagerApprovalServiceError } from "@/lib/services/manager-approval-service";
import { applyOrderDiscount } from "@/lib/services/order-service";
import { ServiceError } from "@/lib/api/service-error";
import { applyOrderDiscountSchema } from "@/lib/validators/order.validators";
import { resolveClientIp } from "@/lib/client-ip";

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

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = applyOrderDiscountSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await applyOrderDiscount({
      orderId,
      discountAmount: parsed.data.discountAmount,
      discountPercent: parsed.data.discountPercent,
      approvalToken: parsed.data.managerApprovalToken,
      requester: {
        userId: auth.session.user.id,
        sessionId: auth.session.authoritative.sessionId,
        authVersion: auth.session.authoritative.authVersion,
        terminalId: auth.session.authoritative.terminalId,
        permissions: auth.session.user.permissions,
      },
      reason: parsed.data.reason,
      auditIpAddress: resolveClientIp(request),
    });

    return ok(serializeRecord(updated));
  } catch (error) {
    if (error instanceof ManagerApprovalServiceError) {
      return fail(
        approvalErrorMessage(error.code),
        error.code,
        error.status,
      );
    }
    return fail(
      error instanceof ServiceError
        ? error.message
        : "Failed to apply discount",
      "APPLY_DISCOUNT_FAILED",
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
