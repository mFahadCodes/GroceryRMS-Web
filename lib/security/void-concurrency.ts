import type { OrderStatus, Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-C2 (approved): void is a pre-finalization cancellation.
 * Exact voidable statuses — do not broaden.
 */
export const VOIDABLE_ORDER_STATUSES = [
  "Open",
  "PartiallyPaid",
] as const satisfies ReadonlyArray<OrderStatus>;

export type VoidableOrderStatus = (typeof VOIDABLE_ORDER_STATUSES)[number];

export const ORDER_NOT_VOIDABLE = "ORDER_NOT_VOIDABLE";
export const ORDER_VOID_CONFLICT = "ORDER_VOID_CONFLICT";

export type VoidClaimData = {
  voidReason: string;
  approvedByUserId: number | null;
};

export function isVoidableOrderStatus(
  status: OrderStatus,
): status is VoidableOrderStatus {
  return (VOIDABLE_ORDER_STATUSES as ReadonlyArray<OrderStatus>).includes(
    status,
  );
}

export function assertOrderVoidable(
  status: OrderStatus,
): asserts status is VoidableOrderStatus {
  if (!isVoidableOrderStatus(status)) {
    throw new ServiceError(
      "Order is not voidable",
      ORDER_NOT_VOIDABLE,
      409,
    );
  }
}

/**
 * Compare-and-set the order to Void using the exact voidable allowlist.
 * Requires count === 1. Zero rows: re-read and map to a stable 409.
 */
export async function claimVoidTransition(
  tx: Prisma.TransactionClient,
  orderId: number,
  data: VoidClaimData,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: [...VOIDABLE_ORDER_STATUSES] },
    },
    data: {
      status: "Void",
      voidReason: data.voidReason,
      approvedByUserId: data.approvedByUserId,
    },
  });
  if (claimed.count === 1) return;

  const current = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });
  if (!current) {
    throw new ServiceError("Order not found");
  }
  if (!isVoidableOrderStatus(current.status)) {
    throw new ServiceError(
      "Order is not voidable",
      ORDER_NOT_VOIDABLE,
      409,
    );
  }
  throw new ServiceError(
    "Order void conflict",
    ORDER_VOID_CONFLICT,
    409,
  );
}
