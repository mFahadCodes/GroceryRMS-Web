import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { createPurchaseOrder } from "@/lib/services/inventory-service";
import { createPurchaseOrderSchema } from "@/lib/validators/inventory.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const rows = await prisma.purchaseOrder.findMany({
    where: { isActive: true },
    include: { supplier: true, items: true },
    orderBy: { createdAt: "desc" },
  });
  return ok(rows);
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createPurchaseOrder({
    supplierId: parsed.data.supplierId,
    expectedDelivery: parsed.data.expectedDelivery
      ? new Date(parsed.data.expectedDelivery)
      : null,
    notes: parsed.data.notes,
    items: parsed.data.items.map((row) => ({
      productId: row.productId,
      quantityOrdered: row.quantity,
      unitCost: row.unitCost,
    })),
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_PURCHASE_ORDER",
    tableName: "purchase_orders",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
