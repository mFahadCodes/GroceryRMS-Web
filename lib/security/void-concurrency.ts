import type { Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-C2: authoritative void state transition helpers.
 * Existing Order.status is the concurrency boundary (no schema change).
 * Void eligibility remains "any non-Void order" — matching prior behavior
 * except that an already-voided order cannot be voided again.
 */

export const ORDER_NOT_VOIDABLE = "ORDER_NOT_VOIDABLE";
export const ORDER_VOID_CONFLICT = "ORDER_VOID_CONFLICT";

export type VoidClaimData = {
  voidReason: string;
  approvedByUserId: number | null;
};

/**
 * Compare-and-set the order to Void. Requires count === 1.
 * Zero rows: re-read and map to a stable 409 (or not-found).
 */
export async function claimVoidTransition(
  tx: Prisma.TransactionClient,
  orderId: number,
  data: VoidClaimData,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { not: "Void" },
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
  if (current.status === "Void") {
    throw new ServiceError(
      "Order is already voided",
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
