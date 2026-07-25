import type { OrderStatus, Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-F (approved): items, tax, and manual adjustments are Open-only.
 * Exact mutable statuses — do not broaden.
 */
export const MUTABLE_ORDER_STATUSES = [
  "Open",
] as const satisfies ReadonlyArray<OrderStatus>;

export type MutableOrderStatus = (typeof MUTABLE_ORDER_STATUSES)[number];

export const ORDER_NOT_MUTABLE = "ORDER_NOT_MUTABLE";
export const ORDER_MUTABLE_CONFLICT = "ORDER_MUTABLE_CONFLICT";

export type OrderTotalsPriorState = {
  subTotal: bigint;
  taxAmount: bigint;
  grandTotal: bigint;
};

export type OrderTotalsClaimData = OrderTotalsPriorState & {
  taxRateId?: number | null;
  adjustment?: bigint;
  discountAmount?: bigint;
  serviceCharge?: bigint;
};

export function isMutableOrderStatus(
  status: OrderStatus,
): status is MutableOrderStatus {
  return (MUTABLE_ORDER_STATUSES as ReadonlyArray<OrderStatus>).includes(
    status,
  );
}

export function assertOrderMutable(
  status: OrderStatus,
): asserts status is MutableOrderStatus {
  if (!isMutableOrderStatus(status)) {
    throw new ServiceError(
      "Order is not mutable",
      ORDER_NOT_MUTABLE,
      409,
    );
  }
}

/**
 * Early write claim so subsequent in-transaction reads observe committed
 * contenders under SQLite write serialization. Requires count === 1.
 */
export async function acquireOpenOrderWrite(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: [...MUTABLE_ORDER_STATUSES] },
    },
    data: { updatedAt: new Date() },
  });
  if (claimed.count === 1) return;

  throw new ServiceError("Order is not mutable", ORDER_NOT_MUTABLE, 409);
}

/**
 * Compare-and-set order totals while the order remains Open and still matches
 * the prior mutation-relevant totals read in this transaction.
 * Requires count === 1. Zero rows: re-read and map to a stable 409.
 */
export async function claimOrderTotalsUpdate(
  tx: Prisma.TransactionClient,
  orderId: number,
  prior: OrderTotalsPriorState,
  next: OrderTotalsClaimData,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: [...MUTABLE_ORDER_STATUSES] },
      subTotal: prior.subTotal,
      taxAmount: prior.taxAmount,
      grandTotal: prior.grandTotal,
    },
    data: {
      subTotal: next.subTotal,
      taxAmount: next.taxAmount,
      grandTotal: next.grandTotal,
      ...(next.taxRateId !== undefined ? { taxRateId: next.taxRateId } : {}),
      ...(next.adjustment !== undefined ? { adjustment: next.adjustment } : {}),
      ...(next.discountAmount !== undefined
        ? { discountAmount: next.discountAmount }
        : {}),
      ...(next.serviceCharge !== undefined
        ? { serviceCharge: next.serviceCharge }
        : {}),
    },
  });
  if (claimed.count === 1) return;

  const current = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      subTotal: true,
      taxAmount: true,
      grandTotal: true,
    },
  });
  if (!current) {
    throw new ServiceError("Order not found");
  }
  if (!isMutableOrderStatus(current.status)) {
    throw new ServiceError("Order is not mutable", ORDER_NOT_MUTABLE, 409);
  }
  throw new ServiceError(
    "Order mutable-surface conflict",
    ORDER_MUTABLE_CONFLICT,
    409,
  );
}
