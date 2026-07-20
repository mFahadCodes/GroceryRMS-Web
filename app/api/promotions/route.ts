import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createPromotion,
  listPromotions,
} from "@/lib/services/promotion-service";
import { createPromotionSchema } from "@/lib/validators/promotions";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const rows = await listPromotions();
  return ok(serializeRecord(rows));
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createPromotionSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const created = await createPromotion(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_PROMOTION",
    tableName: "promotion_bundles",
    recordId: created?.id ?? null,
    newValues: parsed.data,
  });
  return ok(serializeRecord(created), 201);
}
