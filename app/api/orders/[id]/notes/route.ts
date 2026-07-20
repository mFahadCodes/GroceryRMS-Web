import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { getServiceErrorMessage } from "@/lib/api/service-error";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
import { updateOrderNotes } from "@/lib/services/order-service";
import { updateOrderNotesSchema } from "@/lib/validators/order.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateOrderNotesSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await updateOrderNotes(orderId, parsed.data.notes);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_ORDER_NOTES",
      tableName: "orders",
      recordId: orderId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      getServiceErrorMessage(error, "Failed to update notes"),
      "UPDATE_ORDER_NOTES_FAILED",
      400,
    );
  }
}
