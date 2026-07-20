import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createCategory,
  listCategoryTree,
  listCategories,
} from "@/lib/services/category-service";
import { createCategorySchema } from "@/lib/validators/category.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_CATALOG, 1);
  if (auth.error) return auth.error;

  const activeOnly =
    request.nextUrl.searchParams.get("activeOnly") !== "false";
  const tree = request.nextUrl.searchParams.get("tree") === "true";
  if (tree) {
    const categories = await listCategoryTree();
    return ok(serializeRecord(categories));
  }
  const categories = await listCategories(activeOnly);
  return ok(serializeRecord(categories));
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const category = await createCategory(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_CATEGORY",
    tableName: "product_categories",
    recordId: category.id,
    newValues: parsed.data,
  });
  return ok(serializeRecord(category), 201);
}
