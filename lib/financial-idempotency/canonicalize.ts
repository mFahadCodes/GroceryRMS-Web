/**
 * Browser-safe canonicalization mirroring lib/security/idempotency.ts rules
 * for mutation-relevant financial payloads (sorted object keys, bigint tags).
 */
export function canonicalizeFinancialPayload(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("Financial fingerprint payload must not be undefined");
  }
  return canonicalizeValue(value);
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (typeof value === "object") {
    if (value instanceof Date) {
      throw new Error("Date values are not allowed in financial fingerprints");
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
  throw new Error("Unsupported financial fingerprint value type");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hex = "";
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function sha256Hex(material: string): Promise<string> {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.subtle || typeof cryptoRef.subtle.digest !== "function") {
    throw new Error("Secure Web Crypto digest is unavailable");
  }
  const encoded = new TextEncoder().encode(material);
  const digest = await cryptoRef.subtle.digest("SHA-256", encoded);
  return bytesToHex(digest);
}
