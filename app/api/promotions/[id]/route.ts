import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  getPromotionById,
  softDeletePromotion,
  updatePromotion,
} from "@/lib/services/promotion-service";
import { updatePromotionSchema } from "@/lib/validators/promotions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const promotionId = Number.parseInt(id, 10);
  if (Number.isNaN(promotionId)) return fail("Invalid id", "INVALID_ID", 400);
  const row = await getPromotionById(promotionId);
  if (!row) return fail("Promotion not found", "NOT_FOUND", 404);
  return ok(serializeRecord(row));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const promotionId = Number.parseInt(id, 10);
  if (Number.isNaN(promotionId)) return fail("Invalid id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updatePromotionSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const updated = await updatePromotion(promotionId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_PROMOTION",
    tableName: "promotion_bundles",
    recordId: promotionId,
    newValues: parsed.data,
  });
  return ok(serializeRecord(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const promotionId = Number.parseInt(id, 10);
  if (Number.isNaN(promotionId)) return fail("Invalid id", "INVALID_ID", 400);

  const deleted = await softDeletePromotion(promotionId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_PROMOTION",
    tableName: "promotion_bundles",
    recordId: promotionId,
  });
  return ok(serializeRecord(deleted));
}
