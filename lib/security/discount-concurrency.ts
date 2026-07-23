import type { OrderStatus, Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-E (approved): discounts are pre-payment only. Exact discountable statuses —
 * do not broaden.
 */
export const DISCOUNTABLE_ORDER_STATUSES = [
  "Open",
] as const satisfies ReadonlyArray<OrderStatus>;

export type DiscountableOrderStatus =
  (typeof DISCOUNTABLE_ORDER_STATUSES)[number];

export const ORDER_NOT_DISCOUNTABLE = "ORDER_NOT_DISCOUNTABLE";
export const ORDER_DISCOUNT_CONFLICT = "ORDER_DISCOUNT_CONFLICT";

export type DiscountPriorFinancialState = {
  discountAmount: bigint;
  taxAmount: bigint;
  grandTotal: bigint;
};

export type DiscountClaimData = DiscountPriorFinancialState & {
  approvedByUserId?: number | null;
};

export function isDiscountableOrderStatus(
  status: OrderStatus,
): status is DiscountableOrderStatus {
  return (DISCOUNTABLE_ORDER_STATUSES as ReadonlyArray<OrderStatus>).includes(
    status,
  );
}

export function assertOrderDiscountable(
  status: OrderStatus,
): asserts status is DiscountableOrderStatus {
  if (!isDiscountableOrderStatus(status)) {
    throw new ServiceError(
      "Order is not discountable",
      ORDER_NOT_DISCOUNTABLE,
      409,
    );
  }
}

/**
 * Compare-and-set discount financial fields while the order remains Open and
 * still matches the prior mutation-relevant totals read in this transaction.
 * Requires count === 1. Zero rows: re-read and map to a stable 409.
 */
export async function claimDiscountMutation(
  tx: Prisma.TransactionClient,
  orderId: number,
  prior: DiscountPriorFinancialState,
  next: DiscountClaimData,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: [...DISCOUNTABLE_ORDER_STATUSES] },
      discountAmount: prior.discountAmount,
      taxAmount: prior.taxAmount,
      grandTotal: prior.grandTotal,
    },
    data: {
      discountAmount: next.discountAmount,
      taxAmount: next.taxAmount,
      grandTotal: next.grandTotal,
      ...(next.approvedByUserId !== undefined
        ? { approvedByUserId: next.approvedByUserId }
        : {}),
    },
  });
  if (claimed.count === 1) return;

  const current = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      discountAmount: true,
      taxAmount: true,
      grandTotal: true,
    },
  });
  if (!current) {
    throw new ServiceError("Order not found");
  }
  if (!isDiscountableOrderStatus(current.status)) {
    throw new ServiceError(
      "Order is not discountable",
      ORDER_NOT_DISCOUNTABLE,
      409,
    );
  }
  throw new ServiceError(
    "Order discount conflict",
    ORDER_DISCOUNT_CONFLICT,
    409,
  );
}
