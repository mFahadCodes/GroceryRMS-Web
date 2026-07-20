import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
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

  try {
    const result = await applyPartialPayment({
      orderId,
      paymentMethodId: parsed.data.paymentMethodId,
      amount: parsed.data.amount,
      referenceNo: parsed.data.referenceNo,
      userId: auth.session.user.id,
    });

    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "PARTIAL_PAYMENT",
      tableName: "orders",
      recordId: orderId,
      newValues: parsed.data,
    });

    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Partial payment failed",
      "PARTIAL_PAYMENT_FAILED",
      400,
    );
  }
}
