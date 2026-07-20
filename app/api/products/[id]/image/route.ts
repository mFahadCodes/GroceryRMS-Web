import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import { getProductById, updateProductImagePath } from "@/lib/services/product-service";
import { saveEntityImage } from "@/lib/upload-image";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  const product = await getProductById(productId);
  if (!product?.isActive) return fail("Product not found", "NOT_FOUND", 404);

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof File)) {
    return fail("Image file is required", "IMAGE_REQUIRED", 400);
  }

  try {
    const imagePath = await saveEntityImage({
      file: image,
      folder: "products",
      entityId: productId,
    });
    const updated = await updateProductImagePath(productId, imagePath);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPLOAD_PRODUCT_IMAGE",
      tableName: "products",
      recordId: productId,
      newValues: { imagePath },
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to upload image",
      "UPLOAD_FAILED",
      400,
    );
  }
}
