/** Client attempt retention mirrors the backend financial replay window. */
export const FINANCIAL_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const FINANCIAL_ATTEMPT_STORAGE_VERSION = 1 as const;

export const FINANCIAL_ATTEMPT_STORAGE_PREFIX =
  "groceryrms.financial-attempt.v1";

export const FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** Visible allowlist matching backend parseIdempotencyKey. */
export const FINANCIAL_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export const FINANCIAL_FINGERPRINT_VERSION = "v1";

export const FRONTEND_FINANCIAL_OPERATIONS = [
  "order.checkout",
  "order.partial-payment",
  "order.refund",
  "order.return",
  "order.void",
] as const;
