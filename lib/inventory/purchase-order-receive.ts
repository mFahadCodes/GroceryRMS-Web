import type { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * Purchase orders created by the current API remain Draft until the one-shot
 * receive mutation completes them. Ordered and PartialReceived are not current
 * receive-entry states; broadening this list changes the business contract.
 */
export const RECEIVABLE_PURCHASE_ORDER_STATUSES = [
  "Draft",
] as const satisfies ReadonlyArray<PurchaseOrderStatus>;

export type ReceivablePurchaseOrderStatus =
  (typeof RECEIVABLE_PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_NOT_FOUND = "PO_NOT_FOUND";
export const PURCHASE_ORDER_NOT_RECEIVABLE = "PO_NOT_RECEIVABLE";
export const PURCHASE_ORDER_RECEIVE_CONFLICT = "PO_RECEIVE_CONFLICT";
export const PURCHASE_ORDER_ITEM_NOT_FOUND = "PO_ITEM_NOT_FOUND";
export const PURCHASE_ORDER_ITEM_CONFLICT = "PO_ITEM_RECEIVE_CONFLICT";
export const PURCHASE_ORDER_DUPLICATE_ITEM = "PO_DUPLICATE_ITEM";

export function isReceivablePurchaseOrderStatus(
  status: PurchaseOrderStatus,
): status is ReceivablePurchaseOrderStatus {
  return (
    RECEIVABLE_PURCHASE_ORDER_STATUSES as ReadonlyArray<PurchaseOrderStatus>
  ).includes(status);
}

export function assertPurchaseOrderReceivable(input: {
  status: PurchaseOrderStatus;
  isActive: boolean;
}): asserts input is {
  status: ReceivablePurchaseOrderStatus;
  isActive: true;
} {
  if (!input.isActive || !isReceivablePurchaseOrderStatus(input.status)) {
    throw new ServiceError(
      "Purchase order is not receivable",
      PURCHASE_ORDER_NOT_RECEIVABLE,
      409,
    );
  }
}

export function assertUniquePurchaseOrderItems(
  items: ReadonlyArray<{ itemId: number }>,
): void {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      throw new ServiceError(
        "Purchase order item appears more than once",
        PURCHASE_ORDER_DUPLICATE_ITEM,
        400,
      );
    }
    seen.add(item.itemId);
  }
}

/**
 * Claim the exact current receive-entry state. This is deliberately the first
 * write in the outer transaction so same-PO contenders cannot both apply
 * inventory effects. A later failure rolls this transition back with the rest
 * of the transaction.
 */
export async function claimPurchaseOrderReceipt(
  tx: Prisma.TransactionClient,
  purchaseOrderId: number,
  receivedAt: Date,
): Promise<void> {
  const claimed = await tx.purchaseOrder.updateMany({
    where: {
      id: purchaseOrderId,
      isActive: true,
      status: { in: [...RECEIVABLE_PURCHASE_ORDER_STATUSES] },
    },
    data: {
      status: "Received",
      receivedAt,
    },
  });
  if (claimed.count === 1) return;

  const current = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, isActive: true },
  });
  if (!current) {
    throw new ServiceError(
      "Purchase order not found",
      PURCHASE_ORDER_NOT_FOUND,
      404,
    );
  }
  if (!current.isActive || !isReceivablePurchaseOrderStatus(current.status)) {
    throw new ServiceError(
      "Purchase order is not receivable",
      PURCHASE_ORDER_NOT_RECEIVABLE,
      409,
    );
  }
  throw new ServiceError(
    "Purchase order receive conflict",
    PURCHASE_ORDER_RECEIVE_CONFLICT,
    409,
  );
}

export async function incrementPurchaseOrderLine(
  tx: Prisma.TransactionClient,
  input: {
    purchaseOrderId: number;
    itemId: number;
    priorQuantity: Prisma.Decimal;
    receivedQuantity: Prisma.Decimal;
  },
): Promise<void> {
  const updated = await tx.purchaseOrderItem.updateMany({
    where: {
      id: input.itemId,
      purchaseOrderId: input.purchaseOrderId,
      quantityReceived: input.priorQuantity,
    },
    data: {
      quantityReceived: { increment: input.receivedQuantity },
    },
  });
  if (updated.count !== 1) {
    throw new ServiceError(
      "Purchase order item changed during receiving",
      PURCHASE_ORDER_ITEM_CONFLICT,
      409,
    );
  }
}
