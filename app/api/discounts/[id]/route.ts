import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  getDiscountById,
  softDeleteDiscount,
  updateDiscount,
} from "@/lib/services/discount-service";
import { updateDiscountSchema } from "@/lib/validators/discounts";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const discountId = Number.parseInt(id, 10);
  if (Number.isNaN(discountId)) {
    return fail("Invalid discount id", "INVALID_ID", 400);
  }

  const discount = await getDiscountById(discountId);
  if (!discount) return fail("Discount not found", "DISCOUNT_NOT_FOUND", 404);
  return ok(serializeRecord(discount));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const discountId = Number.parseInt(id, 10);
  if (Number.isNaN(discountId)) {
    return fail("Invalid discount id", "INVALID_ID", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateDiscountSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const updated = await updateDiscount(discountId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_DISCOUNT",
    tableName: "discounts",
    recordId: discountId,
    newValues: parsed.data,
  });
  return ok(serializeRecord(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const discountId = Number.parseInt(id, 10);
  if (Number.isNaN(discountId)) {
    return fail("Invalid discount id", "INVALID_ID", 400);
  }

  const deleted = await softDeleteDiscount(discountId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_DISCOUNT",
    tableName: "discounts",
    recordId: discountId,
  });
  return ok(serializeRecord(deleted));
}
