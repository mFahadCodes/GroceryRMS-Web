import type { DiscountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CreateDiscountInput,
  UpdateDiscountInput,
} from "@/lib/validators/discounts";

function mapDiscountInput(input: CreateDiscountInput | UpdateDiscountInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.type !== undefined ? { type: input.type as DiscountType } : {}),
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.minOrderAmount !== undefined
      ? { minOrderAmount: input.minOrderAmount }
      : {}),
    ...(input.maxDiscountAmount !== undefined
      ? { maxDiscountAmount: input.maxDiscountAmount }
      : {}),
    ...(input.startDate !== undefined
      ? { startDate: input.startDate ? new Date(input.startDate) : null }
      : {}),
    ...(input.endDate !== undefined
      ? { endDate: input.endDate ? new Date(input.endDate) : null }
      : {}),
    ...(input.requiresApproval !== undefined
      ? { requiresApproval: input.requiresApproval }
      : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
  };
}

export async function listDiscounts(params: {
  page: number;
  limit: number;
  isActive?: boolean;
  type?: DiscountType;
}) {
  const where = {
    ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    ...(params.type ? { type: params.type } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.discount.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.discount.count({ where }),
  ]);

  return { items, total, page: params.page, limit: params.limit };
}

export async function getDiscountById(id: number) {
  return prisma.discount.findUnique({ where: { id } });
}

export async function createDiscount(input: CreateDiscountInput) {
  return prisma.discount.create({
    data: {
      name: input.name,
      type: input.type,
      value: input.value,
      minOrderAmount: input.minOrderAmount ?? 0n,
      maxDiscountAmount: input.maxDiscountAmount ?? 0n,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      requiresApproval: input.requiresApproval ?? false,
      code: input.code ?? null,
    },
  });
}

export async function updateDiscount(id: number, input: UpdateDiscountInput) {
  return prisma.discount.update({
    where: { id },
    data: mapDiscountInput(input),
  });
}

export async function softDeleteDiscount(id: number) {
  return prisma.discount.update({
    where: { id },
    data: { isActive: false },
  });
}
