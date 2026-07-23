import { FRONTEND_FINANCIAL_OPERATIONS } from "./constants";
import type {
  CheckoutBusinessPayload,
  CheckoutPaymentLine,
  FinancialBusinessPayloadByOperation,
  FrontendFinancialOperation,
  PartialPaymentBusinessPayload,
  RefundBusinessPayload,
  ReturnBusinessPayload,
  ReturnItemLine,
  VoidBusinessPayload,
} from "./types";

export function isFrontendFinancialOperation(
  value: unknown,
): value is FrontendFinancialOperation {
  return (
    typeof value === "string" &&
    (FRONTEND_FINANCIAL_OPERATIONS as readonly string[]).includes(value)
  );
}

export function financialOperationPath(
  operation: FrontendFinancialOperation,
  resourceId: number,
): string {
  switch (operation) {
    case "order.checkout":
      return `/api/orders/${resourceId}/checkout`;
    case "order.partial-payment":
      return `/api/orders/${resourceId}/partial-payment`;
    case "order.refund":
      return `/api/orders/${resourceId}/refund`;
    case "order.return":
      return `/api/orders/${resourceId}/return`;
    case "order.void":
      return `/api/orders/${resourceId}/void`;
    default: {
      const _exhaustive: never = operation;
      throw new Error(`Unsupported financial operation: ${_exhaustive}`);
    }
  }
}

function asPaisa(value: bigint | number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("Paisa values must be integers");
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("Invalid paisa value");
}

function requirePaisa(value: bigint | number | string): bigint {
  const parsed = asPaisa(value);
  if (parsed === null) throw new Error("Paisa value is required");
  return parsed;
}

export function buildCheckoutBusinessPayload(input: {
  orderId: number;
  paymentMethodId?: number | null;
  tenderedAmount?: bigint | number | string | null;
  terminalId: number;
  discountPercent?: number;
  taxPercent?: number;
  customerId?: number | null;
  notes?: string | null;
  referenceNo?: string | null;
  redeemPoints?: bigint | number | string;
  payments?: Array<{
    paymentMethodId: number;
    amount: bigint | number | string;
    tenderedAmount?: bigint | number | string;
    referenceNo?: string | null;
  }> | null;
}): CheckoutBusinessPayload {
  const payments: CheckoutPaymentLine[] | null = input.payments
    ? input.payments.map((line) => ({
        paymentMethodId: line.paymentMethodId,
        amount: requirePaisa(line.amount),
        ...(line.tenderedAmount !== undefined
          ? { tenderedAmount: requirePaisa(line.tenderedAmount) }
          : {}),
        ...(line.referenceNo !== undefined
          ? { referenceNo: line.referenceNo }
          : {}),
      }))
    : null;

  let paymentMethodId = input.paymentMethodId ?? null;
  let tenderedAmount = asPaisa(input.tenderedAmount);

  if (paymentMethodId === null && payments && payments.length === 1) {
    paymentMethodId = payments[0].paymentMethodId;
  }
  if (tenderedAmount === null && payments && payments.length === 1) {
    tenderedAmount = payments[0].tenderedAmount ?? payments[0].amount;
  }

  return {
    orderId: input.orderId,
    paymentMethodId,
    tenderedAmount,
    terminalId: input.terminalId,
    discountPercent: input.discountPercent ?? 0,
    taxPercent: input.taxPercent ?? 0,
    customerId: input.customerId ?? null,
    notes: input.notes ?? null,
    referenceNo: input.referenceNo ?? null,
    redeemPoints: asPaisa(input.redeemPoints ?? 0n) ?? 0n,
    payments,
  };
}

export function buildPartialPaymentBusinessPayload(input: {
  orderId: number;
  paymentMethodId: number;
  amount: bigint | number | string;
  referenceNo?: string | null;
}): PartialPaymentBusinessPayload {
  return {
    orderId: input.orderId,
    paymentMethodId: input.paymentMethodId,
    amount: requirePaisa(input.amount),
    referenceNo: input.referenceNo ?? null,
  };
}

export function buildRefundBusinessPayload(input: {
  orderId: number;
  reason: string;
  amount?: bigint | number | string | null;
  paymentMethodId: number;
  terminalId: number;
  referenceNo?: string | null;
}): RefundBusinessPayload {
  return {
    orderId: input.orderId,
    reason: input.reason,
    amount: asPaisa(input.amount),
    paymentMethodId: input.paymentMethodId,
    terminalId: input.terminalId,
    referenceNo: input.referenceNo ?? null,
  };
}

export function canonicalizeReturnItems(items: ReturnItemLine[]): ReturnItemLine[] {
  return [...items]
    .map((item) => ({
      orderItemId: item.orderItemId,
      returnQty: item.returnQty,
      reason: item.reason,
    }))
    .sort((a, b) => a.orderItemId - b.orderItemId);
}

export function buildReturnBusinessPayload(input: {
  orderId: number;
  items: ReturnItemLine[];
  refundAmount: bigint | number | string;
}): ReturnBusinessPayload {
  return {
    orderId: input.orderId,
    items: canonicalizeReturnItems(input.items),
    refundAmount: requirePaisa(input.refundAmount),
  };
}

export function buildVoidBusinessPayload(input: {
  orderId: number;
  reason: string;
  reverseStock?: boolean;
}): VoidBusinessPayload {
  return {
    orderId: input.orderId,
    reason: input.reason,
    reverseStock: input.reverseStock ?? false,
  };
}

export function buildBusinessPayload<O extends FrontendFinancialOperation>(
  operation: O,
  input: unknown,
): FinancialBusinessPayloadByOperation[O] {
  switch (operation) {
    case "order.checkout":
      return buildCheckoutBusinessPayload(
        input as Parameters<typeof buildCheckoutBusinessPayload>[0],
      ) as FinancialBusinessPayloadByOperation[O];
    case "order.partial-payment":
      return buildPartialPaymentBusinessPayload(
        input as Parameters<typeof buildPartialPaymentBusinessPayload>[0],
      ) as FinancialBusinessPayloadByOperation[O];
    case "order.refund":
      return buildRefundBusinessPayload(
        input as Parameters<typeof buildRefundBusinessPayload>[0],
      ) as FinancialBusinessPayloadByOperation[O];
    case "order.return":
      return buildReturnBusinessPayload(
        input as Parameters<typeof buildReturnBusinessPayload>[0],
      ) as FinancialBusinessPayloadByOperation[O];
    case "order.void":
      return buildVoidBusinessPayload(
        input as Parameters<typeof buildVoidBusinessPayload>[0],
      ) as FinancialBusinessPayloadByOperation[O];
    default: {
      const _exhaustive: never = operation;
      throw new Error(`Unsupported financial operation: ${_exhaustive}`);
    }
  }
}

/** Request JSON body for transport — excludes execution credentials. */
export function toRequestBody(
  operation: FrontendFinancialOperation,
  payload: FinancialBusinessPayloadByOperation[FrontendFinancialOperation],
): Record<string, unknown> {
  switch (operation) {
    case "order.checkout": {
      const checkout = payload as CheckoutBusinessPayload;
      return {
        ...(checkout.paymentMethodId !== null
          ? { paymentMethodId: checkout.paymentMethodId }
          : {}),
        ...(checkout.tenderedAmount !== null
          ? { tenderedAmount: checkout.tenderedAmount.toString() }
          : {}),
        terminalId: checkout.terminalId,
        discountPercent: checkout.discountPercent,
        taxPercent: checkout.taxPercent,
        ...(checkout.customerId !== null ? { customerId: checkout.customerId } : {}),
        ...(checkout.notes !== null ? { notes: checkout.notes } : {}),
        ...(checkout.referenceNo !== null
          ? { referenceNo: checkout.referenceNo }
          : {}),
        redeemPoints: checkout.redeemPoints.toString(),
        ...(checkout.payments
          ? {
              payments: checkout.payments.map((line) => ({
                paymentMethodId: line.paymentMethodId,
                amount: line.amount.toString(),
                ...(line.tenderedAmount !== undefined
                  ? { tenderedAmount: line.tenderedAmount.toString() }
                  : {}),
                ...(line.referenceNo !== undefined
                  ? { referenceNo: line.referenceNo }
                  : {}),
              })),
            }
          : {}),
      };
    }
    case "order.partial-payment": {
      const partial = payload as PartialPaymentBusinessPayload;
      return {
        paymentMethodId: partial.paymentMethodId,
        amount: partial.amount.toString(),
        referenceNo: partial.referenceNo,
      };
    }
    case "order.refund": {
      const refund = payload as RefundBusinessPayload;
      return {
        reason: refund.reason,
        ...(refund.amount !== null ? { amount: refund.amount.toString() } : {}),
        paymentMethodId: refund.paymentMethodId,
        terminalId: refund.terminalId,
        referenceNo: refund.referenceNo,
      };
    }
    case "order.return": {
      const ret = payload as ReturnBusinessPayload;
      return {
        items: ret.items,
        refundAmount: ret.refundAmount.toString(),
      };
    }
    case "order.void": {
      const voidPayload = payload as VoidBusinessPayload;
      return {
        reason: voidPayload.reason,
        reverseStock: voidPayload.reverseStock,
      };
    }
    default: {
      const _exhaustive: never = operation;
      throw new Error(`Unsupported financial operation: ${_exhaustive}`);
    }
  }
}
