import { prisma } from "@/lib/prisma";

export async function listEmployees() {
  return prisma.employee.findMany({
    where: { isActive: true },
    include: { user: true },
    orderBy: { name: "asc" },
  });
}

export async function getEmployeeById(id: number) {
  return prisma.employee.findUnique({
    where: { id },
    include: { user: true, payrolls: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
  });
}

export async function createEmployee(input: {
  name: string;
  phone?: string | null;
  email?: string | null;
  cnic?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  category?: "Floor" | "Cashier" | "Delivery" | "Management" | "Warehouse" | "Other";
  employmentType: "FullTime" | "PartTime" | "Contract" | "Daily";
  designation?: string | null;
  joiningDate?: Date;
  basicSalary?: bigint;
  allowances?: bigint;
  deductions?: bigint;
  userId?: number | null;
}) {
  return prisma.employee.create({
    data: {
      ...input,
      phone: input.phone ?? null,
      email: input.email ?? null,
      cnic: input.cnic ?? null,
      address: input.address ?? null,
      emergencyContact: input.emergencyContact ?? null,
      category: input.category ?? "Floor",
      designation: input.designation ?? null,
      joiningDate: input.joiningDate ?? new Date(),
      basicSalary: input.basicSalary ?? 0n,
      allowances: input.allowances ?? 0n,
      deductions: input.deductions ?? 0n,
      userId: input.userId ?? null,
    },
  });
}

export async function updateEmployee(id: number, input: Partial<{
  name: string;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  address: string | null;
  emergencyContact: string | null;
  category: "Floor" | "Cashier" | "Delivery" | "Management" | "Warehouse" | "Other";
  employmentType: "FullTime" | "PartTime" | "Contract" | "Daily";
  designation: string | null;
  joiningDate: Date;
  leavingDate: Date | null;
  basicSalary: bigint;
  allowances: bigint;
  deductions: bigint;
  userId: number | null;
}>) {
  return prisma.employee.update({ where: { id }, data: input });
}

export async function deleteEmployee(id: number) {
  return prisma.employee.update({ where: { id }, data: { isActive: false } });
}
