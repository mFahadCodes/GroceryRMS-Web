import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
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

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
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

    const order = await checkoutFast({
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
    });

    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "CHECKOUT",
      tableName: "orders",
      recordId: orderId,
      newValues: {
        terminalId: parsed.data.terminalId,
        payments: parsed.data.payments,
      },
    });

    return ok(serializeRecord(order));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Checkout failed",
      "CHECKOUT_FAILED",
      400,
    );
  }
}
