import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  updatePaymentMethod,
  deletePaymentMethod,
} from "@/lib/services/settings-service";
import { updatePaymentMethodSchema } from "@/lib/validators/settings.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const paymentMethodId = Number.parseInt(id, 10);
  if (Number.isNaN(paymentMethodId)) return fail("Invalid id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updatePaymentMethodSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await updatePaymentMethod(paymentMethodId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_PAYMENT_METHOD",
    tableName: "payment_methods",
    recordId: paymentMethodId,
    newValues: parsed.data,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const paymentMethodId = Number.parseInt(id, 10);
  if (Number.isNaN(paymentMethodId)) return fail("Invalid id", "INVALID_ID", 400);
  const updated = await deletePaymentMethod(paymentMethodId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_PAYMENT_METHOD",
    tableName: "payment_methods",
    recordId: paymentMethodId,
  });
  return ok(updated);
}
