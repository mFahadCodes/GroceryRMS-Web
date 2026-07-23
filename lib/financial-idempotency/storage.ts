import {
  FINANCIAL_ATTEMPT_RETENTION_MS,
  FINANCIAL_ATTEMPT_STORAGE_PREFIX,
  FINANCIAL_ATTEMPT_STORAGE_VERSION,
  FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_PATTERN,
} from "./constants";
import { isFrontendFinancialOperation } from "./operations";
import type {
  FinancialAttemptRecord,
  FinancialAttemptState,
  FrontendFinancialOperation,
} from "./types";

function storageKey(
  operation: FrontendFinancialOperation,
  resourceId: number,
): string {
  return `${FINANCIAL_ATTEMPT_STORAGE_PREFIX}:${operation}:${resourceId}`;
}

function getSessionStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!storage || typeof storage.getItem !== "function") return null;
    return storage;
  } catch {
    return null;
  }
}

function isAttemptState(value: unknown): value is FinancialAttemptState {
  return value === "pending" || value === "uncertain";
}

export function parseFinancialAttemptRecord(
  raw: unknown,
  now: number = Date.now(),
): FinancialAttemptRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  if (record.version !== FINANCIAL_ATTEMPT_STORAGE_VERSION) return null;
  if (!isFrontendFinancialOperation(record.operation)) return null;
  if (
    typeof record.resourceId !== "number" ||
    !Number.isInteger(record.resourceId) ||
    record.resourceId <= 0
  ) {
    return null;
  }
  if (
    typeof record.key !== "string" ||
    record.key.length < FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH ||
    record.key.length > FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH ||
    !FINANCIAL_IDEMPOTENCY_KEY_PATTERN.test(record.key)
  ) {
    return null;
  }
  if (typeof record.fingerprint !== "string" || record.fingerprint.length < 16) {
    return null;
  }
  if (typeof record.createdAt !== "number" || typeof record.lastAttemptAt !== "number") {
    return null;
  }
  if (!isAttemptState(record.state)) return null;
  if (
    typeof record.retryCount !== "number" ||
    !Number.isInteger(record.retryCount) ||
    record.retryCount < 0
  ) {
    return null;
  }

  // Reject records that embed forbidden sensitive material.
  const forbidden = [
    "managerApprovalToken",
    "managerPin",
    "body",
    "payload",
    "response",
    "headers",
    "authHeader",
    "secret",
  ];
  for (const key of forbidden) {
    if (key in record) return null;
  }

  if (now - record.createdAt > FINANCIAL_ATTEMPT_RETENTION_MS) {
    return null;
  }

  return {
    version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
    operation: record.operation,
    resourceId: record.resourceId,
    key: record.key,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
    lastAttemptAt: record.lastAttemptAt,
    state: record.state,
    retryCount: record.retryCount,
  };
}

export function readFinancialAttempt(
  operation: FrontendFinancialOperation,
  resourceId: number,
  now: number = Date.now(),
): FinancialAttemptRecord | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(storageKey(operation, resourceId));
  if (!raw) return null;
  try {
    const parsed = parseFinancialAttemptRecord(JSON.parse(raw), now);
    if (!parsed) {
      storage.removeItem(storageKey(operation, resourceId));
      return null;
    }
    if (
      parsed.operation !== operation ||
      parsed.resourceId !== resourceId
    ) {
      storage.removeItem(storageKey(operation, resourceId));
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(storageKey(operation, resourceId));
    return null;
  }
}

export function writeFinancialAttempt(record: FinancialAttemptRecord): void {
  const storage = getSessionStorage();
  if (!storage) return;
  const safe: FinancialAttemptRecord = {
    version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
    operation: record.operation,
    resourceId: record.resourceId,
    key: record.key,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
    lastAttemptAt: record.lastAttemptAt,
    state: record.state,
    retryCount: record.retryCount,
  };
  storage.setItem(
    storageKey(record.operation, record.resourceId),
    JSON.stringify(safe),
  );
}

export function clearFinancialAttempt(
  operation: FrontendFinancialOperation,
  resourceId: number,
): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.removeItem(storageKey(operation, resourceId));
}

/** Find any retained checkout attempt (page-refresh recovery). */
export function findRetainedCheckoutAttempt(
  now: number = Date.now(),
): FinancialAttemptRecord | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const prefix = `${FINANCIAL_ATTEMPT_STORAGE_PREFIX}:order.checkout:`;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = parseFinancialAttemptRecord(JSON.parse(raw), now);
      if (parsed?.operation === "order.checkout") return parsed;
      storage.removeItem(key);
    } catch {
      storage.removeItem(key);
    }
  }
  return null;
}

export function createAttemptRecord(input: {
  operation: FrontendFinancialOperation;
  resourceId: number;
  key: string;
  fingerprint: string;
  now?: number;
  state?: FinancialAttemptState;
}): FinancialAttemptRecord {
  const now = input.now ?? Date.now();
  return {
    version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
    operation: input.operation,
    resourceId: input.resourceId,
    key: input.key,
    fingerprint: input.fingerprint,
    createdAt: now,
    lastAttemptAt: now,
    state: input.state ?? "pending",
    retryCount: 0,
  };
}
