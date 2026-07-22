import type { OrderStatus, Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/api/service-error";

/**
 * P0-B: order-row compare-and-set helpers for checkout / partial-payment races.
 * Remaining balance lives in SUM(payments); finalization is gated by Order.status.
 */

export const ORDER_NOT_OPEN = "ORDER_NOT_OPEN";
export const ORDER_NOT_PAYABLE = "ORDER_NOT_PAYABLE";
export const ORDER_FINANCIAL_CONFLICT = "ORDER_FINANCIAL_CONFLICT";
export const PAYMENT_EXCEEDS_REMAINING = "PAYMENT_EXCEEDS_REMAINING";

const PAYABLE_STATUSES: OrderStatus[] = ["Open", "PartiallyPaid"];

export function sumPaymentAmounts(
  payments: ReadonlyArray<{ amount: bigint }>,
): bigint {
  return payments.reduce((sum, payment) => sum + payment.amount, 0n);
}

export function remainingBalance(
  grandTotal: bigint,
  paidSoFar: bigint,
): bigint {
  return grandTotal > paidSoFar ? grandTotal - paidSoFar : 0n;
}

/**
 * Early write on a payable order so subsequent in-transaction payment reads
 * observe committed contenders under SQLite write serialization.
 */
export async function acquirePayableOrderWrite(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: PAYABLE_STATUSES },
    },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new ServiceError(
      "Order must be Open or PartiallyPaid",
      ORDER_NOT_PAYABLE,
      409,
    );
  }
}

export async function claimCheckoutCompletion(
  tx: Prisma.TransactionClient,
  orderId: number,
  data: {
    notes?: string | null;
    customerId?: number | null;
    subTotal: bigint;
    discountAmount: bigint;
    taxAmount: bigint;
    serviceCharge: bigint;
    grandTotal: bigint;
    shiftId: number;
    terminalId: number;
    cashierId: number;
    invoiceNumber: string;
  },
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: "Open" },
    data: {
      ...data,
      status: "Closed",
    },
  });
  if (claimed.count !== 1) {
    throw new ServiceError("Order is not open", ORDER_NOT_OPEN, 409);
  }
}

export async function claimOrderClosedFromPayable(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: PAYABLE_STATUSES },
    },
    data: { status: "Closed" },
  });
  if (claimed.count !== 1) {
    throw new ServiceError(
      "Order financial state changed",
      ORDER_FINANCIAL_CONFLICT,
      409,
    );
  }
}

export async function claimOrderPartiallyPaid(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: PAYABLE_STATUSES },
    },
    data: { status: "PartiallyPaid" },
  });
  if (claimed.count !== 1) {
    throw new ServiceError(
      "Order financial state changed",
      ORDER_FINANCIAL_CONFLICT,
      409,
    );
  }
}

export function assertPaymentWithinRemaining(
  amount: bigint,
  remaining: bigint,
): void {
  if (amount > remaining) {
    throw new ServiceError(
      "Payment exceeds remaining balance",
      PAYMENT_EXCEEDS_REMAINING,
      409,
    );
  }
}
