import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { resolveManagerApproval } from "@/lib/manager-pin";
import { voidOrder } from "@/lib/services/order-service";
import { voidOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

const VOID_MANAGER_LEVEL = 5;

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.VOID_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = voidOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const approval = await resolveManagerApproval({
    userId: auth.session.user.id,
    permissions: auth.session.user.permissions,
    permissionName: PERMS.VOID_ORDERS,
    minimumLevel: VOID_MANAGER_LEVEL,
    managerPin: parsed.data.managerPin,
  });

  if (!approval.ok) {
    const message =
      approval.code === "MANAGER_PIN_REQUIRED"
        ? "Manager PIN required for this action"
        : "Invalid manager PIN";
    return fail(message, approval.code, 403);
  }

  try {
    const result = await voidOrder({
      orderId,
      reason: parsed.data.reason,
      approvedByUserId:
        parsed.data.approvedByUserId ?? approval.approvedByUserId,
      reverseStock: parsed.data.reverseStock ?? false,
    });

    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "VOID_ORDER",
      tableName: "orders",
      recordId: orderId,
      newValues: {
        reason: parsed.data.reason,
        approvedByUserId: approval.approvedByUserId,
      },
    });

    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to void order",
      "VOID_ORDER_FAILED",
      400,
    );
  }
}
