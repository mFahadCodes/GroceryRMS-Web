import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  getCategoryById,
  softDeleteCategory,
  updateCategory,
} from "@/lib/services/category-service";
import { updateCategorySchema } from "@/lib/validators/category.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.VIEW_CATALOG, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const categoryId = Number.parseInt(id, 10);
  if (Number.isNaN(categoryId)) return fail("Invalid category id", "INVALID_ID", 400);

  const category = await getCategoryById(categoryId);
  if (!category) return fail("Category not found", "CATEGORY_NOT_FOUND", 404);

  return ok(serializeRecord(category));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const categoryId = Number.parseInt(id, 10);
  if (Number.isNaN(categoryId)) return fail("Invalid category id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const category = await updateCategory(categoryId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_CATEGORY",
    tableName: "product_categories",
    recordId: categoryId,
    newValues: parsed.data,
  });
  return ok(serializeRecord(category));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const categoryId = Number.parseInt(id, 10);
  if (Number.isNaN(categoryId)) return fail("Invalid category id", "INVALID_ID", 400);
  const category = await softDeleteCategory(categoryId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_CATEGORY",
    tableName: "product_categories",
    recordId: categoryId,
  });
  return ok(serializeRecord(category));
}
