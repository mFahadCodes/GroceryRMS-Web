import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { getLowStockProducts } from "@/lib/services/inventory-service";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  return ok(await getLowStockProducts());
}
