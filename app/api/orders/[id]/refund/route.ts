import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { refundOrder } from "@/lib/services/order-service";
import { refundOrderSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.ISSUE_REFUNDS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = refundOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const result = await refundOrder({
      orderId,
      reason: parsed.data.reason,
      amount: parsed.data.amount,
      paymentMethodId: parsed.data.paymentMethodId,
      terminalId: parsed.data.terminalId,
      cashierId: auth.session.user.id,
      referenceNo: parsed.data.referenceNo,
      // SEC-05B: the REFUND_ORDER audit is transaction-required and written
      // inside the refund transaction; the free-text reason stays on the
      // refund order record and is only summarized in audit metadata.
      auditIpAddress: resolveClientIp(request),
    });

    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to refund order",
      "REFUND_ORDER_FAILED",
      400,
    );
  }
}
