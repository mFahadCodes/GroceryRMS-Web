/**
 * SEC-05A centralized audit metadata sanitizer.
 *
 * Pure module: no Prisma, no I/O, no mutation of inputs. Every audit write and
 * every audit read/export must pass metadata through these helpers.
 */

export const AUDIT_REDACTED = "[REDACTED]";
export const AUDIT_TRUNCATED = "[TRUNCATED]";
export const AUDIT_MAX_DEPTH = "[MAX_DEPTH]";
export const AUDIT_CIRCULAR = "[CIRCULAR]";
export const AUDIT_UNSUPPORTED = "[UNSUPPORTED]";
export const AUDIT_SANITIZER_FAILURE = "[SANITIZER_FAILURE]";

export const AUDIT_SANITIZER_LIMITS = {
  maxDepth: 6,
  maxObjectProperties: 50,
  maxArrayEntries: 50,
  maxStringLength: 2048,
  maxSerializedBytes: 16 * 1024,
  maxErrorMessageLength: 1024,
} as const;

/** Exact normalized key names that always redact. */
const SENSITIVE_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "oldpassword",
  "passwordhash",
  "bootstrappassword",
  "temporarypassword",
  "credential",
  "credentials",
  "pin",
  "managerpin",
  "adminpin",
  "bootstrappin",
  "pinhash",
  "pinpepper",
  "pepper",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "approvaltoken",
  "managerapprovaltoken",
  "tokenhash",
  "jwt",
  "bearer",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "sessiontoken",
  "csrftoken",
  "sessionid",
  "sessionidentifier",
  "authoritativesessionid",
  "rawsession",
  "secret",
  "clientsecret",
  "authsecret",
  "apikey",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "databasepassword",
  "connectionstring",
  "databaseurl",
  "requestbody",
  "rawbody",
  "authorizationheader",
  "cookies",
  "headers",
  "body",
  "authversion",
]);

/** Normalized keys that must remain visible (safe near-matches). */
const SAFE_NEAR_MATCH_KEYS = new Set([
  "passwordchangedat",
  "passwordchanged",
  "reauthenticationrequired",
  "authversionchanged",
  "cookieenabled",
  "tokencount",
  "pincoderequired",
  "sessioncount",
  "mustchangepassword",
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "approval_token",
  "api_key",
  "apikey",
  "password",
  "secret",
  "authorization",
  "auth",
  "key",
  "sig",
  "signature",
]);

const JWT_LIKE =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_LIKE = /^Bearer\s+\S+/i;
const BASIC_AUTH_LIKE = /^Basic\s+[A-Za-z0-9+/=_-]+$/i;
const PEM_PRIVATE_KEY = /-----BEGIN[^-]*PRIVATE KEY-----/i;
const COOKIE_HEADER_LIKE =
  /(?:^|;\s*)(?:session|sid|auth|token|jwt)=[^;]+/i;

export function normalizeAuditKey(key: string): string {
  return key.toLowerCase().replace(/[\s\-_.[\]]+/g, "");
}

export function isSensitiveAuditKey(key: string): boolean {
  const normalized = normalizeAuditKey(key);
  if (SAFE_NEAR_MATCH_KEYS.has(normalized)) return false;
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return false;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - AUDIT_TRUNCATED.length))}${AUDIT_TRUNCATED}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (value instanceof Error) return false;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return false;
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) {
    return false;
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) return false;
  if (typeof Request !== "undefined" && value instanceof Request) return false;
  if (typeof Response !== "undefined" && value instanceof Response) return false;
  if ("$connect" in value || "$transaction" in value) return false;
  // Traverse own enumerable keys for ordinary records, including Object.create(...).
  return true;
}

function redactCredentialBearingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "redacted";
      url.password = "redacted";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "redacted");
      }
    }
    return truncateString(url.toString(), AUDIT_SANITIZER_LIMITS.maxStringLength);
  } catch {
    return truncateString(
      raw.replace(/\/\/([^/@]+)@/g, "//redacted@"),
      AUDIT_SANITIZER_LIMITS.maxStringLength,
    );
  }
}

export function sanitizeSensitiveStringValue(value: string): string {
  const trimmed = value.trim();
  if (BEARER_LIKE.test(trimmed)) return AUDIT_REDACTED;
  if (BASIC_AUTH_LIKE.test(trimmed)) return AUDIT_REDACTED;
  if (JWT_LIKE.test(trimmed) && trimmed.length >= 20) return AUDIT_REDACTED;
  if (PEM_PRIVATE_KEY.test(value)) return AUDIT_REDACTED;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    return redactCredentialBearingUrl(trimmed);
  }
  if (/(?:postgres|mysql|mongodb|redis|amqp):\/\//i.test(trimmed)) {
    return redactCredentialBearingUrl(trimmed);
  }
  if (COOKIE_HEADER_LIKE.test(value) && !trimmed.includes("://")) {
    return AUDIT_REDACTED;
  }
  if (
    /(?:password|passwd|pwd|token|api[_-]?key|secret)\s*[:=]\s*\S+/i.test(
      trimmed,
    ) &&
    !trimmed.includes("://")
  ) {
    return AUDIT_REDACTED;
  }
  return truncateString(value, AUDIT_SANITIZER_LIMITS.maxStringLength);
}

export function sanitizeAuditError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error) && !isErrorLike(error)) {
    return { name: "Error", message: AUDIT_UNSUPPORTED };
  }
  const err = error as Error & { code?: unknown; cause?: unknown };
  const result: Record<string, unknown> = {
    name: truncateString(String(err.name || "Error"), 128),
  };
  if (typeof err.code === "string" || typeof err.code === "number") {
    result.code = err.code;
  }
  if (typeof err.message === "string") {
    result.message = sanitizeSensitiveStringValue(
      truncateString(err.message, AUDIT_SANITIZER_LIMITS.maxErrorMessageLength),
    );
  }
  if (err.cause !== undefined) {
    if (err.cause instanceof Error) {
      result.cause = {
        name: truncateString(err.cause.name || "Error", 128),
      };
    } else if (typeof err.cause === "string") {
      result.cause = sanitizeSensitiveStringValue(
        truncateString(err.cause, 256),
      );
    } else {
      result.cause = { type: typeof err.cause };
    }
  }
  return result;
}

function isErrorLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

type SanitizeContext = {
  depth: number;
  seen: WeakSet<object>;
};

function sanitizeValue(value: unknown, context: SanitizeContext): unknown {
  if (context.depth > AUDIT_SANITIZER_LIMITS.maxDepth) {
    return AUDIT_MAX_DEPTH;
  }
  if (value === null) return null;
  if (value === undefined) return undefined;

  const type = typeof value;
  if (type === "boolean") return value;
  if (type === "number") {
    return Number.isFinite(value) ? value : AUDIT_UNSUPPORTED;
  }
  if (type === "bigint") {
    return truncateString(value.toString(), AUDIT_SANITIZER_LIMITS.maxStringLength);
  }
  if (type === "string") {
    return sanitizeSensitiveStringValue(value as string);
  }
  if (type === "symbol" || type === "function") {
    return AUDIT_UNSUPPORTED;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return AUDIT_UNSUPPORTED;
    return value.toISOString();
  }
  if (value instanceof Error) {
    return sanitizeAuditError(value);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return AUDIT_UNSUPPORTED;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return AUDIT_UNSUPPORTED;
  }

  if (typeof value === "object") {
    if (context.seen.has(value)) return AUDIT_CIRCULAR;
    context.seen.add(value);

    if (Array.isArray(value)) {
      const limited = value.slice(0, AUDIT_SANITIZER_LIMITS.maxArrayEntries);
      const mapped = limited.map((entry) =>
        sanitizeValue(entry, { depth: context.depth + 1, seen: context.seen }),
      );
      if (value.length > AUDIT_SANITIZER_LIMITS.maxArrayEntries) {
        mapped.push(AUDIT_TRUNCATED);
      }
      return mapped;
    }

    if (!isPlainObject(value)) {
      // Request/Response/Headers/Map/Set/Prisma client/etc.
      return AUDIT_UNSUPPORTED;
    }

    const keys = Object.keys(value).sort();
    const limitedKeys = keys.slice(0, AUDIT_SANITIZER_LIMITS.maxObjectProperties);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of limitedKeys) {
      if (isSensitiveAuditKey(key)) {
        result[key] = AUDIT_REDACTED;
        continue;
      }
      // Own properties only; Object.keys already excludes inherited.
      const child = sanitizeValue(value[key], {
        depth: context.depth + 1,
        seen: context.seen,
      });
      if (child !== undefined) {
        result[key] = child;
      }
    }
    if (keys.length > AUDIT_SANITIZER_LIMITS.maxObjectProperties) {
      result._truncated = AUDIT_TRUNCATED;
    }
    return result;
  }

  return AUDIT_UNSUPPORTED;
}

function shrinkToByteLimit(value: unknown): unknown {
  let serialized = stableStringify(value);
  if (utf8ByteLength(serialized) <= AUDIT_SANITIZER_LIMITS.maxSerializedBytes) {
    return value;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const reduced: Record<string, unknown> = Object.create(null);
    for (const [key, entryValue] of entries) {
      const candidate = { ...reduced, [key]: entryValue };
      const candidateJson = stableStringify(candidate);
      if (
        utf8ByteLength(candidateJson) >
        AUDIT_SANITIZER_LIMITS.maxSerializedBytes - 64
      ) {
        break;
      }
      reduced[key] = entryValue;
    }
    reduced._truncated = AUDIT_TRUNCATED;
    serialized = stableStringify(reduced);
    if (utf8ByteLength(serialized) <= AUDIT_SANITIZER_LIMITS.maxSerializedBytes) {
      return reduced;
    }
  }

  if (Array.isArray(value)) {
    const reduced: unknown[] = [];
    for (const entry of value) {
      const candidate = [...reduced, entry];
      if (
        utf8ByteLength(stableStringify(candidate)) >
        AUDIT_SANITIZER_LIMITS.maxSerializedBytes - 64
      ) {
        break;
      }
      reduced.push(entry);
    }
    reduced.push(AUDIT_TRUNCATED);
    return reduced;
  }

  if (typeof value === "string") {
    let low = 0;
    let high = value.length;
    let best = AUDIT_TRUNCATED;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = truncateString(value.slice(0, mid), mid);
      if (utf8ByteLength(candidate) <= AUDIT_SANITIZER_LIMITS.maxSerializedBytes) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best.endsWith(AUDIT_TRUNCATED)
      ? best
      : truncateString(String(best), Math.min(best.length, 64));
  }

  return { _audit: AUDIT_TRUNCATED };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "bigint") return nested.toString();
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(nested as object).sort()) {
        sorted[key] = (nested as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return nested;
  }) ?? "null";
}

/**
 * Recursively sanitize untrusted audit metadata. Never mutates the input.
 * Never throws for circular or unsupported values.
 */
export function sanitizeAuditMetadata(value: unknown): unknown {
  try {
    if (value === undefined) return undefined;
    const sanitized = sanitizeValue(value, { depth: 0, seen: new WeakSet() });
    if (sanitized === undefined) return undefined;
    return shrinkToByteLimit(sanitized);
  } catch {
    return { _audit: AUDIT_SANITIZER_FAILURE };
  }
}

export function sanitizeAuditValue(value: unknown): unknown {
  return sanitizeAuditMetadata(value);
}

/**
 * Produce a JSON string safe for AuditLog.oldValues / newValues persistence.
 */
export function serializeSafeAuditMetadata(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const sanitized = sanitizeAuditMetadata(value);
    if (sanitized === undefined || sanitized === null) return null;
    const json = stableStringify(sanitized);
    if (utf8ByteLength(json) > AUDIT_SANITIZER_LIMITS.maxSerializedBytes) {
      return stableStringify({ _audit: AUDIT_TRUNCATED });
    }
    return json;
  } catch {
    return stableStringify({ _audit: AUDIT_SANITIZER_FAILURE });
  }
}

/**
 * Defense-in-depth for stored JSON strings (historical or newly written).
 */
export function sanitizeStoredAuditJson(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return serializeSafeAuditMetadata(parsed);
  } catch {
    // Non-JSON historical blobs: treat as opaque string under a safe wrapper.
    return serializeSafeAuditMetadata({
      _raw: sanitizeSensitiveStringValue(raw),
    });
  }
}
