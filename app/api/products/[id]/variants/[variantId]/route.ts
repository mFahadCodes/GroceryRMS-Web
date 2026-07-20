import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  softDeleteProductVariant,
  updateProductVariant,
} from "@/lib/services/product-service";
import { updateProductVariantSchema } from "@/lib/validators/product.validators";

type RouteContext = { params: Promise<{ id: string; variantId: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id, variantId } = await context.params;
  const productId = Number.parseInt(id, 10);
  const variantIdNum = Number.parseInt(variantId, 10);
  if (Number.isNaN(productId) || Number.isNaN(variantIdNum)) {
    return fail("Invalid id", "INVALID_ID", 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateProductVariantSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await updateProductVariant(productId, variantIdNum, parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_PRODUCT_VARIANT",
      tableName: "product_variants",
      recordId: variantIdNum,
      newValues: parsed.data,
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update variant",
      "UPDATE_VARIANT_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id, variantId } = await context.params;
  const productId = Number.parseInt(id, 10);
  const variantIdNum = Number.parseInt(variantId, 10);
  if (Number.isNaN(productId) || Number.isNaN(variantIdNum)) {
    return fail("Invalid id", "INVALID_ID", 400);
  }

  try {
    const deleted = await softDeleteProductVariant(productId, variantIdNum);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_PRODUCT_VARIANT",
      tableName: "product_variants",
      recordId: variantIdNum,
    });
    return ok(serializeRecord(deleted));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete variant",
      "DELETE_VARIANT_FAILED",
      400,
    );
  }
}
