import { prisma } from "@/lib/prisma";

export async function getExpenseById(id: number) {
  return prisma.supplierExpense.findUnique({
    where: { id },
    include: { supplier: true },
  });
}

export async function updateExpense(
  id: number,
  input: {
    supplierId?: number | null;
    description?: string;
    amount?: bigint;
    expenseDate?: Date;
    invoiceNumber?: string | null;
    category?: string | null;
    notes?: string | null;
  },
) {
  const expense = await prisma.supplierExpense.findUnique({ where: { id } });
  if (!expense) throw new Error("Expense not found");
  if (expense.isPaid) throw new Error("Cannot update a paid expense");

  return prisma.supplierExpense.update({
    where: { id },
    data: {
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.expenseDate !== undefined ? { expenseDate: input.expenseDate } : {}),
      ...(input.invoiceNumber !== undefined
        ? { invoiceNumber: input.invoiceNumber }
        : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: { supplier: true },
  });
}

export async function deleteExpense(id: number) {
  const expense = await prisma.supplierExpense.findUnique({ where: { id } });
  if (!expense) throw new Error("Expense not found");
  if (expense.isPaid) throw new Error("Cannot delete a paid expense");
  return prisma.supplierExpense.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function listExpenses() {
  return prisma.supplierExpense.findMany({
    where: { isActive: true },
    include: { supplier: true },
    orderBy: { expenseDate: "desc" },
  });
}

export async function createExpense(input: {
  supplierId?: number | null;
  description: string;
  amount: bigint;
  expenseDate?: Date;
  invoiceNumber?: string | null;
  category?: string | null;
  notes?: string | null;
}) {
  const expense = await prisma.supplierExpense.create({
    data: {
      supplierId: input.supplierId ?? null,
      description: input.description,
      amount: input.amount,
      expenseDate: input.expenseDate ?? new Date(),
      invoiceNumber: input.invoiceNumber ?? null,
      category: input.category ?? null,
      notes: input.notes ?? null,
    },
    include: { supplier: true },
  });
  if (input.supplierId) {
    await prisma.supplier.update({
      where: { id: input.supplierId },
        data: { balance: { increment: input.amount } },
    });
  }
  return expense;
}

export async function payExpense(id: number) {
  return prisma.$transaction(async (tx) => {
    const expense = await tx.supplierExpense.findUnique({
      where: { id },
      include: { supplier: true },
    });
    if (!expense) throw new Error("Expense not found");
    if (expense.isPaid) return expense;

    const updated = await tx.supplierExpense.update({
      where: { id },
      data: { isPaid: true },
      include: { supplier: true },
    });

    if (expense.supplierId) {
      await tx.supplier.update({
        where: { id: expense.supplierId },
        data: { balance: { decrement: expense.amount } },
      });
    }
    return updated;
  });
}
