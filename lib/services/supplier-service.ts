import { prisma } from "@/lib/prisma";

export async function listSuppliers() {
  return prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function getSupplierById(id: number) {
  return prisma.supplier.findUnique({
    where: { id },
    include: { expenses: { orderBy: { expenseDate: "desc" } }, purchaseOrders: true },
  });
}

export async function createSupplier(input: {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}) {
  return prisma.supplier.create({
    data: {
      ...input,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function updateSupplier(id: number, input: Partial<{
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  balance: number | bigint;
}>) {
  return prisma.supplier.update({ where: { id }, data: input });
}

export async function deleteSupplier(id: number) {
  return prisma.supplier.update({ where: { id }, data: { isActive: false } });
}
