import { prisma } from "@/lib/prisma";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/lib/validators/category.validators";

export async function listCategories(activeOnly = true) {
  return prisma.productCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
}

export async function listCategoryTree() {
  const categories = await prisma.productCategory.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  const byParent = new Map<number | null, typeof categories>();
  for (const category of categories) {
    const key = category.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), category]);
  }

  type Category = (typeof categories)[number];
  type CategoryNode = Category & { children: CategoryNode[] };

  const build = (parentId: number | null): CategoryNode[] =>
    (byParent.get(parentId) ?? []).map((category) => ({
      ...category,
      children: build(category.id),
    }));

  return build(null);
}

export async function createCategory(input: CreateCategoryInput) {
  return prisma.productCategory.create({ data: input });
}

export async function updateCategory(id: number, input: UpdateCategoryInput) {
  return prisma.productCategory.update({ where: { id }, data: input });
}

export async function softDeleteCategory(id: number) {
  return prisma.productCategory.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function getCategoryById(id: number) {
  return prisma.productCategory.findUnique({
    where: { id },
    include: { products: { where: { isActive: true } } },
  });
}

export async function mergeCategory(sourceId: number, targetCategoryId: number) {
  if (sourceId === targetCategoryId) {
    throw new Error("Source and target category must differ");
  }

  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.productCategory.findUnique({ where: { id: sourceId } }),
      tx.productCategory.findUnique({ where: { id: targetCategoryId } }),
    ]);
    if (!source?.isActive) throw new Error("Source category not found");
    if (!target?.isActive) throw new Error("Target category not found");

    const moved = await tx.product.updateMany({
      where: { categoryId: sourceId },
      data: { categoryId: targetCategoryId },
    });

    const deleted = await tx.productCategory.update({
      where: { id: sourceId },
      data: { isActive: false },
    });

    return { movedProducts: moved.count, category: deleted };
  });
}

export async function updateCategoryImagePath(id: number, imagePath: string) {
  return prisma.productCategory.update({
    where: { id },
    data: { imagePath },
  });
}
