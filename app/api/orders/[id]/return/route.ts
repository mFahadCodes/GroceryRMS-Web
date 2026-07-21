import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { resolveClientIp } from "@/lib/client-ip";
import { returnOrderItems } from "@/lib/services/order-service";
import { returnOrderItemsSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.ISSUE_REFUNDS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return fail("Invalid order id", "INVALID_ORDER_ID", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = returnOrderItemsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const result = await returnOrderItems({
      orderId,
      items: parsed.data.items,
      refundAmount: parsed.data.refundAmount,
      cashierId: auth.session.user.id,
      // SEC-05B: the RETURN audit is transaction-required and written inside
      // the return transaction; per-item free-text reasons stay on the
      // refund order items and are never copied into audit metadata.
      auditIpAddress: resolveClientIp(request),
    });

    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to process return",
      "RETURN_FAILED",
      400,
    );
  }
}
