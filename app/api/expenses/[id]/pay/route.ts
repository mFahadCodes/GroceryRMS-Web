import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { payExpense } from "@/lib/services/expense-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const expenseId = Number.parseInt(id, 10);
  if (Number.isNaN(expenseId)) return fail("Invalid expense id", "INVALID_ID", 400);
  const paid = await payExpense(expenseId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "PAY_EXPENSE",
    tableName: "supplier_expenses",
    recordId: expenseId,
    newValues: { isPaid: true },
  });
  return ok(paid);
}
