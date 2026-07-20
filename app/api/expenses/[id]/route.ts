import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  deleteExpense,
  getExpenseById,
  updateExpense,
} from "@/lib/services/expense-service";
import { updateExpenseSchema } from "@/lib/validators/finance.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const expenseId = Number.parseInt(id, 10);
  if (Number.isNaN(expenseId)) return fail("Invalid expense id", "INVALID_ID", 400);

  const expense = await getExpenseById(expenseId);
  if (!expense) return fail("Expense not found", "EXPENSE_NOT_FOUND", 404);
  return ok(serializeRecord(expense));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const expenseId = Number.parseInt(id, 10);
  if (Number.isNaN(expenseId)) return fail("Invalid expense id", "INVALID_ID", 400);

  const body = await parseJsonBody<unknown>(request);
  const parsed = updateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const updated = await updateExpense(expenseId, {
      ...parsed.data,
      expenseDate: parsed.data.expenseDate
        ? new Date(parsed.data.expenseDate)
        : undefined,
    });
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "UPDATE_EXPENSE",
      tableName: "supplier_expenses",
      recordId: expenseId,
      newValues: parsed.data,
    });
    return ok(serializeRecord(updated));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update expense",
      "UPDATE_EXPENSE_FAILED",
      400,
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_EXPENSES, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const expenseId = Number.parseInt(id, 10);
  if (Number.isNaN(expenseId)) return fail("Invalid expense id", "INVALID_ID", 400);

  try {
    const deleted = await deleteExpense(expenseId);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "DELETE_EXPENSE",
      tableName: "supplier_expenses",
      recordId: expenseId,
    });
    return ok(serializeRecord(deleted));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to delete expense",
      "DELETE_EXPENSE_FAILED",
      400,
    );
  }
}
