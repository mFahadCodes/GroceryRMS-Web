import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getProductByBarcode } from "@/lib/services/product-service";

type RouteContext = { params: Promise<{ barcode: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.VIEW_CATALOG, 1);
  if (auth.error) return auth.error;
  const { barcode } = await context.params;
  const product = await getProductByBarcode(barcode);
  if (!product) return ok({ found: false });
  return ok({ found: true, product: serializeRecord(product) });
}
