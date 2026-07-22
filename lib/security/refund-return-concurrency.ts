import type { Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-C1: refund/return monetary and quantity concurrency helpers.
 * `returnedQuantity` is the authoritative per-source-line CAS counter.
 * `sourceOrderItemId` is lineage only.
 */

export const REFUND_EXCEEDS_REFUNDABLE_AMOUNT = "REFUND_EXCEEDS_REFUNDABLE_AMOUNT";
export const RETURN_QUANTITY_EXCEEDS_REMAINING = "RETURN_QUANTITY_EXCEEDS_REMAINING";
export const RETURN_HISTORY_RECONCILIATION_REQUIRED =
  "RETURN_HISTORY_RECONCILIATION_REQUIRED";
export const ORDER_NOT_REFUNDABLE = "ORDER_NOT_REFUNDABLE";
export const ORDER_ITEM_NOT_RETURNABLE = "ORDER_ITEM_NOT_RETURNABLE";
export const REFUND_RETURN_CONFLICT = "REFUND_RETURN_CONFLICT";

export function remainingRefundableAmount(
  grandTotal: bigint,
  alreadyRefundedAbsolute: bigint,
): bigint {
  return grandTotal > alreadyRefundedAbsolute
    ? grandTotal - alreadyRefundedAbsolute
    : 0n;
}

/**
 * Absolute monetary value already reversed via child Refund orders.
 * Child grandTotal values are stored negative.
 */
export async function sumCommittedRefundAbsolute(
  tx: Prisma.TransactionClient,
  sourceOrderId: number,
): Promise<bigint> {
  const children = await tx.order.findMany({
    where: {
      originalOrderId: sourceOrderId,
      orderType: "Refund",
      isActive: true,
    },
    select: { grandTotal: true },
  });
  return children.reduce((sum, child) => {
    const absolute = child.grandTotal < 0n ? -child.grandTotal : child.grandTotal;
    return sum + absolute;
  }, 0n);
}

export function assertRefundWithinRemaining(
  amount: bigint,
  remaining: bigint,
): void {
  if (amount > remaining) {
    throw new ServiceError(
      "Refund exceeds refundable amount",
      REFUND_EXCEEDS_REFUNDABLE_AMOUNT,
      409,
    );
  }
}

/**
 * Acquire a write claim on a Closed source order so subsequent aggregate reads
 * observe committed contenders under SQLite write serialization.
 */
export async function acquireClosedOrderWrite(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: "Closed" },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new ServiceError(
      "Only closed orders can be refunded or returned",
      ORDER_NOT_REFUNDABLE,
      409,
    );
  }
}

/**
 * Legacy merchandise-return guard: child Refund orders that already have
 * negative OrderItem rows without sourceOrderItemId cannot be safely mapped
 * to source lines. Block further merchandise returns/refunds that restore stock.
 */
export async function assertNoLegacyNullLineageReturns(
  tx: Prisma.TransactionClient,
  sourceOrderId: number,
): Promise<void> {
  const legacy = await tx.orderItem.findFirst({
    where: {
      sourceOrderItemId: null,
      quantity: { lt: 0 },
      order: {
        originalOrderId: sourceOrderId,
        orderType: "Refund",
        isActive: true,
      },
    },
    select: { id: true },
  });
  if (legacy) {
    throw new ServiceError(
      "Return history requires reconciliation before further merchandise returns",
      RETURN_HISTORY_RECONCILIATION_REQUIRED,
      409,
    );
  }
}

export type ReturnQuantityClaim = {
  orderItemId: number;
  claimQty: number;
};

/**
 * Authoritative CAS on OrderItem.returnedQuantity for each source line.
 * Claims are sorted by orderItemId for deterministic multi-line locking order.
 */
export async function claimSourceReturnQuantities(
  tx: Prisma.TransactionClient,
  sourceOrderId: number,
  claims: ReadonlyArray<ReturnQuantityClaim>,
): Promise<void> {
  const sorted = [...claims].sort((a, b) => a.orderItemId - b.orderItemId);
  for (const claim of sorted) {
    if (!Number.isInteger(claim.claimQty) || claim.claimQty <= 0) {
      throw new ServiceError(
        `Return quantity exceeds remaining for item ${claim.orderItemId}`,
        RETURN_QUANTITY_EXCEEDS_REMAINING,
        409,
      );
    }

    const item = await tx.orderItem.findFirst({
      where: {
        id: claim.orderItemId,
        orderId: sourceOrderId,
        status: { not: "Void" },
      },
    });
    if (!item) {
      throw new ServiceError(
        `Order item ${claim.orderItemId} not found`,
        ORDER_ITEM_NOT_RETURNABLE,
        409,
      );
    }

    const proposed = item.returnedQuantity + claim.claimQty;
    if (proposed > item.quantity) {
      throw new ServiceError(
        `Return quantity exceeds remaining for item ${claim.orderItemId}`,
        RETURN_QUANTITY_EXCEEDS_REMAINING,
        409,
      );
    }

    const updated = await tx.orderItem.updateMany({
      where: {
        id: item.id,
        orderId: sourceOrderId,
        returnedQuantity: item.returnedQuantity,
        quantity: { gte: proposed },
      },
      data: { returnedQuantity: proposed },
    });
    if (updated.count !== 1) {
      throw new ServiceError(
        "Order item return quantity conflict",
        REFUND_RETURN_CONFLICT,
        409,
      );
    }
  }
}
