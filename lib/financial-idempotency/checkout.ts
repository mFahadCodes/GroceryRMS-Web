import {
  abandonFinancialAttempt,
  executeFinancialAttempt,
} from "./executor";
import { buildCheckoutBusinessPayload } from "./operations";
import {
  findRetainedCheckoutAttempt,
  readFinancialAttempt,
} from "./storage";
import type {
  CheckoutBusinessPayload,
  FinancialAttemptRecord,
} from "./types";

export type CheckoutRequestFields = {
  paymentMethodId: number;
  tenderedAmount: bigint | string;
  terminalId: number;
  discountPercent: number;
  taxPercent: number;
  customerId?: number | null;
  notes?: string | null;
  referenceNo?: string | null;
};

export function buildCheckoutPayloadFromForm(
  orderId: number,
  fields: CheckoutRequestFields,
): CheckoutBusinessPayload {
  return buildCheckoutBusinessPayload({
    orderId,
    paymentMethodId: fields.paymentMethodId,
    tenderedAmount: fields.tenderedAmount,
    terminalId: fields.terminalId,
    discountPercent: fields.discountPercent,
    taxPercent: fields.taxPercent,
    customerId: fields.customerId,
    notes: fields.notes,
    referenceNo: fields.referenceNo,
  });
}

export function loadCheckoutRecoveryAttempt(): FinancialAttemptRecord | null {
  return findRetainedCheckoutAttempt();
}

export function loadCheckoutAttemptForOrder(
  orderId: number,
): FinancialAttemptRecord | null {
  return readFinancialAttempt("order.checkout", orderId);
}

export function submitCheckoutWithIdempotency<T>(input: {
  orderId: number;
  fields: CheckoutRequestFields;
  signal?: AbortSignal;
}): Promise<
  Awaited<ReturnType<typeof executeFinancialAttempt<"order.checkout", T>>>
> {
  const business = buildCheckoutPayloadFromForm(input.orderId, input.fields);
  return executeFinancialAttempt<"order.checkout", T>({
    operation: "order.checkout",
    resourceId: input.orderId,
    business,
    signal: input.signal,
  });
}

export function abandonCheckoutAttempt(orderId: number): void {
  abandonFinancialAttempt("order.checkout", orderId);
}
