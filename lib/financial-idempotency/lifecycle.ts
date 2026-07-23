import { createFinancialIdempotencyKey } from "./key";
import {
  clearFinancialAttempt,
  createAttemptRecord,
  readFinancialAttempt,
  writeFinancialAttempt,
} from "./storage";
import type {
  FinancialAttemptRecord,
  FrontendFinancialOperation,
} from "./types";

export type PrepareFinancialAttemptResult =
  | {
      ok: true;
      attempt: FinancialAttemptRecord;
      reusedKey: boolean;
    }
  | {
      ok: false;
      reason:
        | "fingerprint_mismatch"
        | "missing_secure_key"
        | "storage_unavailable_for_new_key";
      existing?: FinancialAttemptRecord;
      message: string;
    };

/**
 * Resolve the attempt record for a financial call.
 * Same fingerprint reuses the stored key; a changed fingerprint blocks until
 * explicit abandonment. Never mint a replacement key for uncertain retries.
 */
export function prepareFinancialAttempt(input: {
  operation: FrontendFinancialOperation;
  resourceId: number;
  fingerprint: string;
  now?: number;
}): PrepareFinancialAttemptResult {
  const now = input.now ?? Date.now();
  const existing = readFinancialAttempt(input.operation, input.resourceId, now);

  if (existing) {
    if (existing.fingerprint !== input.fingerprint) {
      return {
        ok: false,
        reason: "fingerprint_mismatch",
        existing,
        message:
          "Checkout payload changed while a previous financial attempt is still retained. Reconcile or abandon before starting a new attempt.",
      };
    }
    const reused: FinancialAttemptRecord = {
      ...existing,
      lastAttemptAt: now,
      state: "pending",
      retryCount: existing.retryCount + (existing.state === "uncertain" ? 1 : 0),
    };
    writeFinancialAttempt(reused);
    return { ok: true, attempt: reused, reusedKey: true };
  }

  let key: string;
  try {
    key = createFinancialIdempotencyKey();
  } catch {
    return {
      ok: false,
      reason: "missing_secure_key",
      message: "Secure Web Crypto is required to create a financial idempotency key",
    };
  }

  const attempt = createAttemptRecord({
    operation: input.operation,
    resourceId: input.resourceId,
    key,
    fingerprint: input.fingerprint,
    now,
    state: "pending",
  });
  writeFinancialAttempt(attempt);
  return { ok: true, attempt, reusedKey: false };
}

export function markFinancialAttemptUncertain(
  attempt: FinancialAttemptRecord,
  now: number = Date.now(),
): FinancialAttemptRecord {
  const next: FinancialAttemptRecord = {
    ...attempt,
    state: "uncertain",
    lastAttemptAt: now,
  };
  writeFinancialAttempt(next);
  return next;
}

export function markFinancialAttemptPending(
  attempt: FinancialAttemptRecord,
  now: number = Date.now(),
): FinancialAttemptRecord {
  const next: FinancialAttemptRecord = {
    ...attempt,
    state: "pending",
    lastAttemptAt: now,
  };
  writeFinancialAttempt(next);
  return next;
}

export function completeFinancialAttempt(
  operation: FrontendFinancialOperation,
  resourceId: number,
): void {
  clearFinancialAttempt(operation, resourceId);
}

/**
 * Explicit abandonment after operator confirmation. Does not invent a new key.
 */
export function abandonFinancialAttempt(
  operation: FrontendFinancialOperation,
  resourceId: number,
): void {
  clearFinancialAttempt(operation, resourceId);
}
