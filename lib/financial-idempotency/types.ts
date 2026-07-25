import { FRONTEND_FINANCIAL_OPERATIONS } from "./constants";

export type FrontendFinancialOperation =
  (typeof FRONTEND_FINANCIAL_OPERATIONS)[number];

export type FinancialAttemptState = "pending" | "uncertain";

export type FinancialAttemptRecord = {
  version: typeof import("./constants").FINANCIAL_ATTEMPT_STORAGE_VERSION;
  operation: FrontendFinancialOperation;
  resourceId: number;
  key: string;
  fingerprint: string;
  createdAt: number;
  lastAttemptAt: number;
  state: FinancialAttemptState;
  retryCount: number;
};

export type CheckoutBusinessPayload = {
  orderId: number;
  paymentMethodId: number | null;
  tenderedAmount: bigint | null;
  terminalId: number;
  discountPercent: number;
  taxPercent: number;
  customerId: number | null;
  notes: string | null;
  referenceNo: string | null;
  redeemPoints: bigint;
  payments: CheckoutPaymentLine[] | null;
};

export type CheckoutPaymentLine = {
  paymentMethodId: number;
  amount: bigint;
  tenderedAmount?: bigint;
  referenceNo?: string | null;
};

export type PartialPaymentBusinessPayload = {
  orderId: number;
  paymentMethodId: number;
  amount: bigint;
  referenceNo: string | null;
};

export type RefundBusinessPayload = {
  orderId: number;
  reason: string;
  amount: bigint | null;
  paymentMethodId: number;
  terminalId: number;
  referenceNo: string | null;
};

export type ReturnItemLine = {
  orderItemId: number;
  returnQty: number;
  reason: string;
};

export type ReturnBusinessPayload = {
  orderId: number;
  items: ReturnItemLine[];
  refundAmount: bigint;
};

export type VoidBusinessPayload = {
  orderId: number;
  reason: string;
  reverseStock: boolean;
};

export type StockTakeApplyItemLine = {
  itemId: number;
  countedQty: string | number;
};

export type StockTakeApplyBusinessPayload = {
  stockTakeId: number;
  items: StockTakeApplyItemLine[];
};

export type FinancialBusinessPayloadByOperation = {
  "order.checkout": CheckoutBusinessPayload;
  "order.partial-payment": PartialPaymentBusinessPayload;
  "order.refund": RefundBusinessPayload;
  "order.return": ReturnBusinessPayload;
  "order.void": VoidBusinessPayload;
  "inventory.stock-take-apply": StockTakeApplyBusinessPayload;
};

export type FinancialExecutionCredentials = {
  /** Void original execution only — never fingerprinted or persisted. */
  managerApprovalToken?: string;
};

export type FinancialErrorClass =
  | "success"
  | "network_uncertain"
  | "timeout_uncertain"
  | "abort_uncertain"
  | "server_uncertain"
  | "in_progress"
  | "payload_mismatch"
  | "key_expired"
  | "business_conflict"
  | "client_terminal"
  | "unknown_uncertain";

export type ClassifyFinancialErrorResult = {
  classification: FinancialErrorClass;
  preservesAttempt: boolean;
  requiresOrderRefresh: boolean;
  allowsSameKeyRetry: boolean;
  code?: string;
  status?: number;
  message: string;
};
