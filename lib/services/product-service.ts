import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/api/serialize";
import { enqueueSync } from "@/lib/sync-queue";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "@/lib/validators/product.validators";

const productInclude = {
  category: true,
  taxRate: true,
  variants: { where: { isActive: true } },
};

async function productIdsForStockStatus(
  stockStatus: "low" | "ok" | "out",
): Promise<number[]> {
  if (stockStatus === "out") {
    const rows = await prisma.product.findMany({
      where: { isActive: true, currentStock: { equals: new Prisma.Decimal(0) } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
  if (stockStatus === "low") {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM products
      WHERE is_active = 1
      AND CAST(current_stock AS REAL) <= CAST(reorder_level AS REAL)
      AND CAST(current_stock AS REAL) > 0
    `;
    return rows.map((row) => row.id);
  }
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM products
    WHERE is_active = 1
    AND CAST(current_stock AS REAL) > CAST(reorder_level AS REAL)
  `;
  return rows.map((row) => row.id);
}

export async function listProducts(params: {
  page: number;
  limit: number;
  q?: string;
  barcode?: string;
  categoryId?: number;
  activeOnly: boolean;
  stockStatus?: "low" | "ok" | "out";
}) {
  const stockIds = params.stockStatus
    ? await productIdsForStockStatus(params.stockStatus)
    : undefined;

  const where: Prisma.ProductWhereInput = {
    ...(params.activeOnly ? { isActive: true } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(stockIds ? { id: { in: stockIds } } : {}),
    ...(params.barcode
      ? { barcode: params.barcode }
      : params.q
        ? {
            OR: [
              { name: { contains: params.q } },
              { sku: { contains: params.q } },
              { barcode: { contains: params.q } },
            ],
          }
        : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total, page: params.page, limit: params.limit };
}

export async function getProductById(id: number) {
  return prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });
}

export async function getProductByBarcode(barcode: string) {
  return prisma.product.findFirst({
    where: { barcode, isActive: true },
    include: productInclude,
  });
}

export async function getProductStockMovements(
  productId: number,
  page: number,
  limit: number,
) {
  const where = { productId };
  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: true },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return { items, total, page, limit };
}

export async function softDeleteProduct(id: number) {
  const openOrderItems = await prisma.orderItem.count({
    where: {
      productId: id,
      order: { status: "Open" },
      status: { not: "Void" },
    },
  });
  if (openOrderItems > 0) {
    throw new Error("Cannot delete product used in open orders");
  }
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id },
      data: { isActive: false },
    });
    await enqueueSync(
      {
        tableName: "products",
        recordId: id,
        operation: "DELETE",
        payload: { id, isActive: false },
      },
      tx,
    );
    return product;
  });
}

export async function createProductVariant(input: {
  productId: number;
  name: string;
  priceOverride: bigint;
  sku?: string | null;
  barcode?: string | null;
}) {
  return prisma.productVariant.create({
    data: {
      productId: input.productId,
      name: input.name,
      priceOverride: input.priceOverride,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
    },
  });
}

export async function updateProductVariant(
  productId: number,
  variantId: number,
  input: {
    name?: string;
    priceOverride?: bigint;
    sku?: string | null;
    barcode?: string | null;
  },
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId, isActive: true },
  });
  if (!variant) throw new Error("Variant not found");

  return prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priceOverride !== undefined
        ? { priceOverride: input.priceOverride }
        : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
    },
  });
}

export async function softDeleteProductVariant(
  productId: number,
  variantId: number,
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId, isActive: true },
  });
  if (!variant) throw new Error("Variant not found");

  const openOrderItems = await prisma.orderItem.count({
    where: {
      variantId,
      order: { status: "Open" },
      status: { not: "Void" },
    },
  });
  if (openOrderItems > 0) {
    throw new Error("Cannot delete variant used in open orders");
  }

  return prisma.productVariant.update({
    where: { id: variantId },
    data: { isActive: false },
  });
}

export async function createProduct(input: CreateProductInput) {
  const { variants, currentStock, reorderLevel, expiryDate, ...data } = input;

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        ...data,
        maxDiscount: data.maxDiscount ?? 0n,
        currentStock: toDecimal(currentStock),
        reorderLevel: toDecimal(reorderLevel ?? 0),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        variants: variants?.length ? { create: variants } : undefined,
      },
      include: productInclude,
    });
    await enqueueSync(
      {
        tableName: "products",
        recordId: product.id,
        operation: "CREATE",
        payload: { id: product.id, name: product.name, sku: product.sku },
      },
      tx,
    );
    return product;
  });
}

export async function updateProduct(id: number, input: UpdateProductInput) {
  const { variants, currentStock, reorderLevel, expiryDate, ...data } = input;

  return prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        ...data,
        ...(currentStock !== undefined
          ? { currentStock: toDecimal(currentStock) }
          : {}),
        ...(reorderLevel !== undefined
          ? { reorderLevel: toDecimal(reorderLevel) }
          : {}),
        ...(expiryDate !== undefined
          ? { expiryDate: expiryDate ? new Date(expiryDate) : null }
          : {}),
      },
    });

    if (variants?.length) {
      for (const variant of variants) {
        await tx.productVariant.create({
          data: { ...variant, productId: id },
        });
      }
    }

    await enqueueSync(
      {
        tableName: "products",
        recordId: id,
        operation: "UPDATE",
        payload: { id, ...data },
      },
      tx,
    );

    return tx.product.findUnique({
      where: { id },
      include: productInclude,
    });
  });
}

export async function updateProductImagePath(id: number, imagePath: string) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id },
      data: { imagePath },
      include: productInclude,
    });
    await enqueueSync(
      {
        tableName: "products",
        recordId: id,
        operation: "UPDATE",
        payload: { id, imagePath },
      },
      tx,
    );
    return product;
  });
}

export { productInclude };
