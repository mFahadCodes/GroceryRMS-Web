import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { resolveManagerApproval } from "@/lib/manager-pin";
import { applyOrderDiscount } from "@/lib/services/order-service";
import { applyOrderDiscountSchema } from "@/lib/validators/order.validators";
import { resolveClientIp } from "@/lib/client-ip";

type RouteContext = { params: Promise<{ id: string }> };

const DISCOUNT_MANAGER_LEVEL = 4;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.APPLY_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = applyOrderDiscountSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const approval = await resolveManagerApproval({
    userId: auth.session.user.id,
    permissions: auth.session.user.permissions,
    permissionName: PERMS.APPLY_DISCOUNTS,
    minimumLevel: DISCOUNT_MANAGER_LEVEL,
    managerUserId: parsed.data.managerUserId,
    managerPin: parsed.data.managerPin,
    clientIp: resolveClientIp(request),
  });

  if (!approval.ok) {
    if (approval.code === "MANAGER_PIN_THROTTLED") {
      const response = fail(
        "Manager PIN verification temporarily unavailable",
        approval.code,
        429,
      );
      response.headers.set(
        "Retry-After",
        String(approval.retryAfterSeconds ?? 60),
      );
      return response;
    }
    if (approval.code === "PIN_SECURITY_UNAVAILABLE") {
      return fail("PIN security is unavailable", approval.code, 503);
    }
    const message =
      approval.code === "MANAGER_PIN_REQUIRED"
        ? "Manager PIN required for this discount"
        : "Invalid manager PIN";
    return fail(message, approval.code, 403);
  }

  try {
    const updated = await applyOrderDiscount({
      orderId,
      discountAmount: parsed.data.discountAmount,
      discountPercent: parsed.data.discountPercent,
      approvedByUserId:
        approval.approvedByUserId,
    });

    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "APPLY_ORDER_DISCOUNT",
      tableName: "orders",
      recordId: orderId,
      newValues: {
        discountAmount: parsed.data.discountAmount,
        discountPercent: parsed.data.discountPercent,
        reason: parsed.data.reason,
        approvedByUserId: approval.approvedByUserId,
      },
    });

    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to apply discount",
      "APPLY_DISCOUNT_FAILED",
      400,
    );
  }
}
