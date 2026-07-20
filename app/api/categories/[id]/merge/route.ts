import { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import { mergeCategory } from "@/lib/services/category-service";

const mergeSchema = z.object({
  targetCategoryId: z.number().int().positive(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const categoryId = Number.parseInt(id, 10);
  if (Number.isNaN(categoryId)) return fail("Invalid category id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const result = await mergeCategory(categoryId, parsed.data.targetCategoryId);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "MERGE_CATEGORY",
      tableName: "product_categories",
      recordId: categoryId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(result));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to merge category",
      "MERGE_FAILED",
      400,
    );
  }
}
