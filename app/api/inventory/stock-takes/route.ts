import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { createStockTake } from "@/lib/services/inventory-service";
import { createStockTakeSchema } from "@/lib/validators/inventory.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const rows = await prisma.stockTake.findMany({
    where: { isActive: true },
    include: { items: true, user: true },
    orderBy: { createdAt: "desc" },
  });
  return ok(rows);
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createStockTakeSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createStockTake({
    notes: parsed.data.notes,
    userId: auth.session.user.id,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_STOCK_TAKE",
    tableName: "stock_takes",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
