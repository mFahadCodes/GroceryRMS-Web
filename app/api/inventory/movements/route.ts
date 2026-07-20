import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { createStockMovement } from "@/lib/services/inventory-service";
import { createStockMovementSchema } from "@/lib/validators/inventory.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createStockMovementSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const movement = await createStockMovement({
    productId: parsed.data.productId,
    type: parsed.data.type,
    quantity: parsed.data.quantity,
    costAmount: parsed.data.costAmount,
    reference: parsed.data.reference,
    notes: parsed.data.notes,
    userId: auth.session.user.id,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_STOCK_MOVEMENT",
    tableName: "stock_movements",
    recordId: movement.id,
    newValues: parsed.data,
  });
  return ok(movement, 201);
}
