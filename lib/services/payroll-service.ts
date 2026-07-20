import { prisma } from "@/lib/prisma";

export async function getPayrollById(id: number) {
  return prisma.payroll.findUnique({
    where: { id },
    include: { employee: true },
  });
}

export async function listPayrolls() {
  return prisma.payroll.findMany({
    where: { isActive: true },
    include: { employee: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export async function generatePayrollRun(input: {
  month: number;
  year: number;
  employeeIds?: number[];
}) {
  return prisma.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({
      where: {
        isActive: true,
        ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}),
      },
    });
    const rows = [];
    for (const employee of employees) {
      const existing = await tx.payroll.findUnique({
        where: {
          employeeId_year_month: {
            employeeId: employee.id,
            year: input.year,
            month: input.month,
          },
        },
      });
      const bonus = existing?.bonus ?? 0n;
      const advance = existing?.advance ?? 0n;
      const netSalary =
        employee.basicSalary +
        employee.allowances -
        employee.deductions +
        bonus -
        advance;

      const payroll = await tx.payroll.upsert({
        where: {
          employeeId_year_month: {
            employeeId: employee.id,
            year: input.year,
            month: input.month,
          },
        },
        update: {
          basicSalary: employee.basicSalary,
          allowances: employee.allowances,
          deductions: employee.deductions,
          bonus,
          advance,
          netSalary,
          status: "Pending",
        },
        create: {
          employeeId: employee.id,
          month: input.month,
          year: input.year,
          basicSalary: employee.basicSalary,
          allowances: employee.allowances,
          deductions: employee.deductions,
          bonus: 0n,
          advance: 0n,
          netSalary,
          status: "Pending",
        },
      });
      rows.push(payroll);
    }
    return rows;
  });
}

export async function updatePayroll(
  id: number,
  input: { bonus?: bigint; advance?: bigint; notes?: string | null },
) {
  const payroll = await prisma.payroll.findUnique({ where: { id } });
  if (!payroll) {
    throw new Error("Payroll not found");
  }

  const bonus = input.bonus ?? payroll.bonus;
  const advance = input.advance ?? payroll.advance;
  const netSalary =
    payroll.basicSalary + payroll.allowances - payroll.deductions + bonus - advance;

  return prisma.payroll.update({
    where: { id },
    data: {
      ...(input.bonus !== undefined ? { bonus: input.bonus } : {}),
      ...(input.advance !== undefined ? { advance: input.advance } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      netSalary,
    },
    include: { employee: true },
  });
}

export async function payPayroll(id: number) {
  return prisma.payroll.update({
    where: { id },
    data: { status: "Paid", paidAt: new Date() },
    include: { employee: true },
  });
}
