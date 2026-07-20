import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createProduct,
  getProductByBarcode,
  listProducts,
} from "@/lib/services/product-service";
import {
  createProductSchema,
  productListQuerySchema,
} from "@/lib/validators/product.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_CATALOG, 1);
  if (auth.error) return auth.error;

  const parsed = productListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const { barcode, stockStatus, ...query } = parsed.data;

  if (barcode) {
    const product = await getProductByBarcode(barcode);
    if (!product) return fail("Product not found", "PRODUCT_NOT_FOUND", 404);
    return ok(serializeRecord(product));
  }

  const result = await listProducts({ ...query, stockStatus });
  return ok({
    ...result,
    items: serializeRecord(result.items),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const product = await createProduct(parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "CREATE_PRODUCT",
      tableName: "products",
      recordId: product.id,
      newValues: parsed.data,
    });
    return ok(serializeRecord(product), 201);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to create product",
      "CREATE_PRODUCT_FAILED",
      400,
    );
  }
}
