import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { listExpenses, createExpense } from "@/lib/services/expense-service";
import { createExpenseSchema } from "@/lib/validators/finance.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;
  return ok(await listExpenses());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createExpense({
    supplierId: parsed.data.supplierId,
    description: parsed.data.description,
    amount: parsed.data.amount,
    expenseDate: parsed.data.expenseDate
      ? new Date(parsed.data.expenseDate)
      : undefined,
    invoiceNumber: parsed.data.invoiceNumber,
    category: parsed.data.category,
    notes: parsed.data.notes,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_EXPENSE",
    tableName: "supplier_expenses",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
