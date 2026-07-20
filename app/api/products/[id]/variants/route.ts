import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { createProductVariant } from "@/lib/services/product-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRODUCTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const productId = Number.parseInt(id, 10);
  if (Number.isNaN(productId)) return fail("Invalid product id", "INVALID_ID", 400);

  const body = await parseJsonBody<{
    name?: string;
    priceOverride?: string | number;
    sku?: string | null;
    barcode?: string | null;
  }>(request);
  if (!body?.name || body.priceOverride === undefined) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400);
  }

  const created = await createProductVariant({
    productId,
    name: body.name,
    priceOverride: BigInt(body.priceOverride),
    sku: body.sku,
    barcode: body.barcode,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_PRODUCT_VARIANT",
    tableName: "product_variants",
    recordId: created.id,
    newValues: body,
  });
  return ok(created, 201);
}
