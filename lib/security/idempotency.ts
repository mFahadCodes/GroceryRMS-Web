import { createHash } from "node:crypto";

/** Replay window for successful financial idempotency records (P0-A). */
export const IDEMPOTENCY_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_RESPONSE_MAX_BYTES = 32 * 1024;

/** Visible allowlist: letters, digits, `.` `_` `:` `-` — no whitespace/control. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export const IDEMPOTENCY_SCOPE_VERSION = "v1";
export const IDEMPOTENCY_REQUEST_HASH_VERSION = "v1";

export const IDEMPOTENCY_TERMINAL_SENTINEL = "t:none";

export const FINANCIAL_IDEMPOTENCY_OPERATIONS = [
  "order.checkout",
  "order.partial-payment",
  "order.refund",
  "order.return",
  "order.void",
] as const;

export type FinancialIdempotencyOperation =
  (typeof FINANCIAL_IDEMPOTENCY_OPERATIONS)[number];

export type IdempotencyRecordState = "IN_PROGRESS" | "COMPLETED";

export type IdempotencyKeyParseResult =
  | { ok: true; key: string }
  | { ok: false; code: "IDEMPOTENCY_KEY_MISSING" | "IDEMPOTENCY_KEY_INVALID"; message: string };

/**
 * Parse a single Idempotency-Key header value. Does not trim invalid keys into
 * validity. Multiple/joined values (commas) are rejected.
 */
export function parseIdempotencyKey(
  headerValue: string | null | undefined,
): IdempotencyKeyParseResult {
  if (headerValue === null || headerValue === undefined) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_MISSING",
      message: "Idempotency-Key header is required",
    };
  }
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_MISSING",
      message: "Idempotency-Key header is required",
    };
  }
  if (
    headerValue.includes(",") ||
    headerValue.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    headerValue.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(headerValue)
  ) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "Idempotency-Key header is invalid",
    };
  }
  return { ok: true, key: headerValue };
}

/** SHA-256 hex digest of the raw key. Caller must discard the raw key after. */
export function hashIdempotencyKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function formatTerminalScope(
  authoritativeTerminalId: number | null | undefined,
): string {
  if (
    authoritativeTerminalId === null ||
    authoritativeTerminalId === undefined ||
    !Number.isInteger(authoritativeTerminalId) ||
    authoritativeTerminalId <= 0
  ) {
    return IDEMPOTENCY_TERMINAL_SENTINEL;
  }
  return `t:${authoritativeTerminalId}`;
}

/**
 * Versioned unique scope hash. Uses length-prefixed fields so IDs cannot collide
 * across field boundaries. Raw key is never included — only its digest.
 */
export function buildIdempotencyScopeHash(input: {
  actorUserId: number;
  authoritativeTerminalId: number | null | undefined;
  operation: FinancialIdempotencyOperation;
  resourceType: string;
  resourceId: number;
  keyDigest: string;
}): string {
  const terminalScope = formatTerminalScope(input.authoritativeTerminalId);
  const material = [
    IDEMPOTENCY_SCOPE_VERSION,
    lengthPrefixed(String(input.actorUserId)),
    lengthPrefixed(terminalScope),
    lengthPrefixed(input.operation),
    lengthPrefixed(input.resourceType),
    lengthPrefixed(String(input.resourceId)),
    lengthPrefixed(input.keyDigest),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Hash only a strict validated business DTO plus server-owned operation and
 * resource identity. Object keys are sorted recursively; array order is preserved.
 */
export function buildIdempotencyRequestHash(input: {
  operation: FinancialIdempotencyOperation;
  resourceType: string;
  resourceId: number;
  payload: unknown;
}): string {
  const canonical = {
    v: IDEMPOTENCY_REQUEST_HASH_VERSION,
    operation: input.operation,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payload: canonicalizeIdempotencyPayload(input.payload),
  };
  return createHash("sha256")
    .update(stableStringify(canonical), "utf8")
    .digest("hex");
}

export function canonicalizeIdempotencyPayload(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("Idempotency payload must not be undefined at the root");
  }
  return canonicalizeValue(value);
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (typeof value === "object") {
    if (value instanceof Date) {
      throw new Error("Date values are not allowed in idempotency payloads");
    }
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const entry = record[key];
      if (entry === undefined) continue;
      out[key] = canonicalizeValue(entry);
    }
    return out;
  }
  throw new Error("Unsupported idempotency payload value type");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

export function buildReplaySnapshot(input: {
  status: number;
  body: unknown;
}): { responseStatus: number; responseBody: string } {
  const responseBody = JSON.stringify({ success: true, data: input.body }, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  const bytes = Buffer.byteLength(responseBody, "utf8");
  if (bytes > IDEMPOTENCY_RESPONSE_MAX_BYTES) {
    throw new Error("Idempotency response snapshot exceeds size limit");
  }
  return {
    responseStatus: input.status,
    responseBody,
  };
}

export function isIdempotencyReplayExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}
