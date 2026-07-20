import type { CashDrawerLog, Prisma } from "@prisma/client";

type PaymentMethodLike = {
  code?: string | null;
  name: string;
};

export function isCashPaymentMethod(method: PaymentMethodLike): boolean {
  return (
    method.code?.toUpperCase() === "CASH" ||
    method.name.toLowerCase().includes("cash")
  );
}

export function saleDrawerDescription(
  orderNumber: string,
  method: PaymentMethodLike,
): string {
  const prefix = isCashPaymentMethod(method) ? "[CASH]" : "[NONCASH]";
  return `${prefix} ${orderNumber} (${method.name})`;
}

export function refundDrawerDescription(
  orderNumber: string,
  method: PaymentMethodLike,
): string {
  const prefix = isCashPaymentMethod(method) ? "[CASH]" : "[NONCASH]";
  return `${prefix} Refund for ${orderNumber} (${method.name})`;
}

export function isCashDrawerSaleLog(log: Pick<CashDrawerLog, "type" | "description">): boolean {
  return log.type === "Sale" && (log.description?.startsWith("[CASH]") ?? false);
}

export function isCashDrawerRefundLog(
  log: Pick<CashDrawerLog, "type" | "description">,
): boolean {
  return log.type === "Refund" && (log.description?.startsWith("[CASH]") ?? false);
}

export async function createSaleDrawerLog(
  tx: Prisma.TransactionClient,
  input: {
    shiftId: number;
    orderId: number;
    userId: number;
    orderNumber: string;
    paymentMethod: PaymentMethodLike;
    amount: bigint;
  },
) {
  await tx.cashDrawerLog.create({
    data: {
      shiftId: input.shiftId,
      type: "Sale",
      amount: input.amount,
      description: saleDrawerDescription(input.orderNumber, input.paymentMethod),
      orderId: input.orderId,
      userId: input.userId,
    },
  });
}
