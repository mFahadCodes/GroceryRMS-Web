import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  getProductById,
  softDeleteProduct,
  updateProduct,
} from "@/lib/services/product-service";
import { updateProductSchema } from "@/lib/validators/product.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.VIEW_CATALOG, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  const product = await getProductById(productId);
  if (!product) return fail("Product not found", "PRODUCT_NOT_FOUND", 404);

  return ok(serializeRecord(product));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const product = await updateProduct(productId, parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_PRODUCT",
      tableName: "products",
      recordId: productId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(product));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update product",
      "UPDATE_PRODUCT_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  try {
    const product = await softDeleteProduct(productId);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_PRODUCT",
      tableName: "products",
      recordId: productId,
    });
    return ok(serializeRecord(product));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete product",
      "DELETE_PRODUCT_FAILED",
      400,
    );
  }
}
