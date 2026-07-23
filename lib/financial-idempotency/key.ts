import {
  FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_PATTERN,
} from "./constants";

function getSubtleCrypto(): Crypto {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function") {
    throw new Error("Secure Web Crypto is unavailable");
  }
  return cryptoRef;
}

function bytesToKey(bytes: Uint8Array): string {
  // Base64url without padding — alphabet is backend-safe ([A-Za-z0-9_-] plus we
  // only emit the url-safe set; length for 16 bytes is 22 chars).
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Cryptographically secure Idempotency-Key for financial attempts.
 * Prefer randomUUID(); fall back to ≥16 random bytes. Never uses insecure PRNGs.
 */
export function createFinancialIdempotencyKey(): string {
  const cryptoRef = getSubtleCrypto();

  if (typeof cryptoRef.randomUUID === "function") {
    const uuid = cryptoRef.randomUUID();
    if (
      uuid.length >= FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH &&
      uuid.length <= FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH &&
      FINANCIAL_IDEMPOTENCY_KEY_PATTERN.test(uuid)
    ) {
      return uuid;
    }
  }

  const bytes = new Uint8Array(16);
  cryptoRef.getRandomValues(bytes);
  const key = bytesToKey(bytes);
  if (
    key.length < FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH ||
    !FINANCIAL_IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new Error("Failed to generate a backend-safe financial idempotency key");
  }
  return key;
}
