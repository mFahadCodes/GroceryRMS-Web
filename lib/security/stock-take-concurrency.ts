import { Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

export const APPLICABLE_STOCK_TAKE_STATUSES = ["InProgress"] as const;

export const STOCK_TAKE_NOT_IN_PROGRESS = "STOCK_TAKE_NOT_IN_PROGRESS";
export const STOCK_TAKE_ITEM_NOT_FOUND = "STOCK_TAKE_ITEM_NOT_FOUND";
export const STOCK_TAKE_STALE_STOCK = "STOCK_TAKE_STALE_STOCK";

/**
 * CAS claim for stock-take completion. Fails closed if the stock-take is already
 * completed, cancelled, or does not exist.
 */
export async function claimStockTakeCompletion(
  tx: Prisma.TransactionClient,
  stockTakeId: number,
  completedAt: Date = new Date(),
) {
  const result = await tx.stockTake.updateMany({
    where: {
      id: stockTakeId,
      status: { in: [...APPLICABLE_STOCK_TAKE_STATUSES] },
    },
    data: {
      status: "Completed",
      completedAt,
    },
  });

  if (result.count !== 1) {
    throw new ServiceError(
      "Stock take is not in progress or already completed/cancelled",
      STOCK_TAKE_NOT_IN_PROGRESS,
      409,
    );
  }
}

/**
 * Asserts that all requested line items belong to the designated stock take.
 */
export function assertAllItemsKnown(
  stockTakeItems: Array<{ id: number }>,
  requestItems: Array<{ itemId: number }>,
) {
  const knownItemIds = new Set(stockTakeItems.map((item) => item.id));
  for (const row of requestItems) {
    if (!knownItemIds.has(row.itemId)) {
      throw new ServiceError(
        `Stock take item ${row.itemId} not found in this stock take`,
        STOCK_TAKE_ITEM_NOT_FOUND,
        404,
      );
    }
  }
}

/**
 * Asserts product current stock matches the expected stock snapshot captured
 * when the stock take was initiated.
 */
export function assertStockNotStale(
  expectedQty: Prisma.Decimal | string | number,
  currentStock: Prisma.Decimal | string | number,
) {
  const expected = new Prisma.Decimal(expectedQty);
  const current = new Prisma.Decimal(currentStock);
  if (!expected.equals(current)) {
    throw new ServiceError(
      "Stock level has changed since the stock take snapshot was created",
      STOCK_TAKE_STALE_STOCK,
      409,
    );
  }
}
