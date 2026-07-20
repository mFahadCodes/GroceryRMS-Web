import { prisma } from "@/lib/prisma";
import type {
  CreatePromotionInput,
  UpdatePromotionInput,
} from "@/lib/validators/promotions";

const bundleInclude = {
  category: true,
  items: {
    where: { isActive: true },
    include: { product: true },
  },
};

export async function listPromotions() {
  return prisma.promotionBundle.findMany({
    where: { isActive: true },
    include: bundleInclude,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function getPromotionById(id: number) {
  return prisma.promotionBundle.findUnique({
    where: { id },
    include: bundleInclude,
  });
}

export async function createPromotion(input: CreatePromotionInput) {
  return prisma.promotionBundle.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      dealPrice: input.dealPrice,
      originalPrice: input.originalPrice,
      displayOrder: input.displayOrder ?? 0,
      imagePath: input.imageUrl ?? null,
      categoryId: input.categoryId ?? null,
      items: {
        create: input.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
    },
    include: bundleInclude,
  });
}

export async function updatePromotion(id: number, input: UpdatePromotionInput) {
  return prisma.$transaction(async (tx) => {
    await tx.promotionBundle.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.dealPrice !== undefined ? { dealPrice: input.dealPrice } : {}),
        ...(input.originalPrice !== undefined
          ? { originalPrice: input.originalPrice }
          : {}),
        ...(input.displayOrder !== undefined
          ? { displayOrder: input.displayOrder }
          : {}),
        ...(input.imageUrl !== undefined ? { imagePath: input.imageUrl } : {}),
        ...(input.categoryId !== undefined
          ? { categoryId: input.categoryId }
          : {}),
      },
    });

    if (input.items?.length) {
      await tx.promotionBundleItem.updateMany({
        where: { bundleId: id },
        data: { isActive: false },
      });
      await tx.promotionBundleItem.createMany({
        data: input.items.map((item) => ({
          bundleId: id,
          productId: item.productId,
          quantity: item.quantity,
        })),
      });
    }

    return tx.promotionBundle.findUnique({
      where: { id },
      include: bundleInclude,
    });
  });
}

export async function softDeletePromotion(id: number) {
  return prisma.promotionBundle.update({
    where: { id },
    data: { isActive: false },
  });
}
