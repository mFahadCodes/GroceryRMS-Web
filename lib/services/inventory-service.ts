import { Prisma } from "@prisma/client";
import { writeRequiredAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { buildInventoryApplyAuditMetadata } from "@/lib/security/audit-metadata";
import { formatPKR } from "@/lib/currency";

export async function getInventorySummary() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { currentStock: true, reorderLevel: true, costPrice: true },
  });

  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalStockValue = 0n;

  for (const product of products) {
    const stock = Number(product.currentStock.toString());
    const reorder = Number(product.reorderLevel.toString());
    if (stock <= 0) {
      outOfStockCount += 1;
    } else if (stock <= reorder) {
      lowStockCount += 1;
    }
    totalStockValue +=
      (BigInt(Math.round(stock * 100)) * product.costPrice) / 100n;
  }

  const supplierCount = await prisma.supplier.count({ where: { isActive: true } });

  return {
    totalProducts: products.length,
    lowStockCount,
    totalStockValue,
    totalStockValueFormatted: formatPKR(totalStockValue),
    supplierCount,
    outOfStockCount,
  };
}

export async function createStockMovement(input: {
  productId: number;
  type: "Purchase" | "Consumption" | "Waste" | "Adjustment" | "Sale" | "Return";
  quantity: string | number;
  costAmount?: bigint;
  reference?: string | null;
  notes?: string | null;
  userId?: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const qty = new Prisma.Decimal(input.quantity);
    await tx.product.update({
      where: { id: input.productId },
      data: { currentStock: { increment: qty } },
    });
    return tx.stockMovement.create({
      data: {
        productId: input.productId,
        type: input.type,
        quantity: qty,
        costAmount: input.costAmount ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        userId: input.userId ?? null,
      },
    });
  });
}

export async function getLowStockProducts() {
  return prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  }).then((rows) => rows.filter((row) => row.currentStock.lte(row.reorderLevel)));
}

export async function getPurchaseOrderById(id: number) {
  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  });
}

export async function createPurchaseOrder(input: {
  supplierId: number;
  expectedDelivery?: Date | null;
  notes?: string | null;
  items: Array<{ productId: number; quantityOrdered: string | number; unitCost: bigint }>;
}) {
  return prisma.$transaction(async (tx) => {
    const totalAmount = input.items.reduce(
      (sum, item) => sum + item.unitCost * BigInt(Math.round(Number(item.quantityOrdered))),
      0n,
    );
    return tx.purchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        status: "Draft",
        orderedAt: new Date(),
        expectedDelivery: input.expectedDelivery ?? null,
        notes: input.notes ?? null,
        totalAmount,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            quantityOrdered: new Prisma.Decimal(item.quantityOrdered),
            quantityReceived: new Prisma.Decimal(0),
            unitCost: item.unitCost,
          })),
        },
      },
      include: { items: true, supplier: true },
    });
  });
}

export async function receivePurchaseOrder(
  id: number,
  items: Array<{ itemId: number; quantityReceived: string | number }>,
  userId?: number,
  auditIpAddress?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) throw new Error("Purchase order not found");

    for (const row of items) {
      const poItem = po.items.find((item) => item.id === row.itemId);
      if (!poItem) throw new Error(`PO item ${row.itemId} not found`);

      const qty = new Prisma.Decimal(row.quantityReceived);
      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { quantityReceived: { increment: qty } },
      });
      await tx.product.update({
        where: { id: poItem.productId },
        data: { currentStock: { increment: qty } },
      });
      await tx.stockMovement.create({
        data: {
          productId: poItem.productId,
          type: "Purchase",
          quantity: qty,
          costAmount: poItem.unitCost,
          reference: `PO-${po.id}`,
          notes: "Purchase order receive",
          userId: userId ?? null,
        },
      });
    }

    await writeRequiredAudit(tx, {
      userId: userId ?? null,
      action: "RECEIVE_PURCHASE_ORDER",
      recordId: id,
      newValues: buildInventoryApplyAuditMetadata({ itemCount: items.length }),
      ipAddress: auditIpAddress ?? null,
    });

    return tx.purchaseOrder.update({
      where: { id },
      data: { status: "Received", receivedAt: new Date() },
      include: { items: true, supplier: true },
    });
  });
}

export async function createStockTake(input: { notes?: string | null; userId?: number | null }) {
  const products = await prisma.product.findMany({ where: { isActive: true } });
  return prisma.stockTake.create({
    data: {
      notes: input.notes ?? null,
      userId: input.userId ?? null,
      items: {
        create: products.map((product) => ({
          productId: product.id,
          expectedQty: product.currentStock,
          countedQty: product.currentStock,
        })),
      },
    },
    include: { items: { include: { product: true } } },
  });
}

export async function getStockTakeById(id: number) {
  const stockTake = await prisma.stockTake.findFirst({
    where: { id, isActive: true },
    include: {
      user: { select: { id: true, username: true, fullName: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              unitOfMeasure: true,
              currentStock: true,
            },
          },
        },
        orderBy: { productId: "asc" },
      },
    },
  });

  if (!stockTake) return null;

  return {
    ...stockTake,
    items: stockTake.items.map((item) => ({
      ...item,
      variance: item.countedQty.sub(item.expectedQty),
    })),
  };
}

export async function applyStockTake(
  stockTakeId: number,
  items: Array<{ itemId: number; countedQty: string | number }>,
  userId?: number,
  auditIpAddress?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const stockTake = await tx.stockTake.findUnique({
      where: { id: stockTakeId },
      include: { items: true },
    });
    if (!stockTake) throw new Error("Stock take not found");

    for (const row of items) {
      const item = stockTake.items.find((candidate) => candidate.id === row.itemId);
      if (!item) continue;
      const counted = new Prisma.Decimal(row.countedQty);
      const variance = counted.sub(item.expectedQty);
      await tx.stockTakeItem.update({
        where: { id: item.id },
        data: { countedQty: counted },
      });
      await tx.product.update({
        where: { id: item.productId },
        data: { currentStock: counted },
      });
      if (!variance.isZero()) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: "Adjustment",
            quantity: variance,
            notes: `Stock take ${stockTakeId} apply`,
            reference: `ST-${stockTakeId}`,
            userId: userId ?? null,
          },
        });
      }
    }

    await writeRequiredAudit(tx, {
      userId: userId ?? null,
      action: "APPLY_STOCK_TAKE",
      recordId: stockTakeId,
      newValues: buildInventoryApplyAuditMetadata({ itemCount: items.length }),
      ipAddress: auditIpAddress ?? null,
    });

    return tx.stockTake.update({
      where: { id: stockTakeId },
      data: { status: "Completed", completedAt: new Date() },
      include: { items: { include: { product: true } } },
    });
  });
}
