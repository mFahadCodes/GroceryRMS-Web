import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  parseIdempotencyKey,
} from "@/lib/security/idempotency";

describe("parseIdempotencyKey", () => {
  it("rejects a null header value", () => {
    const result = parseIdempotencyKey(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_MISSING");
  });

  it("rejects an undefined header value", () => {
    const result = parseIdempotencyKey(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_MISSING");
  });

  it("rejects an empty string", () => {
    const result = parseIdempotencyKey("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_MISSING");
  });

  it("rejects a key shorter than the minimum length", () => {
    const result = parseIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("rejects a key longer than the maximum length", () => {
    const result = parseIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("accepts a key exactly at the minimum length", () => {
    expect(parseIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH)).ok).toBe(true);
  });

  it("accepts a key exactly at the maximum length", () => {
    expect(parseIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH)).ok).toBe(true);
  });

  it("rejects leading/trailing whitespace without trimming into validity", () => {
    const result = parseIdempotencyKey(" 1234567890abcdef ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("rejects internal whitespace", () => {
    expect(parseIdempotencyKey("1234567890 abcdef").ok).toBe(false);
  });

  it("rejects a comma-joined multi-value header", () => {
    const result = parseIdempotencyKey(
      "1234567890abcdef,1234567890abcdef",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("rejects a trailing comma even with only one real value", () => {
    expect(parseIdempotencyKey("1234567890abcdef,").ok).toBe(false);
  });

  it("rejects embedded newline control characters", () => {
    expect(parseIdempotencyKey("1234567890abcd\nef").ok).toBe(false);
  });

  it("rejects embedded tab control characters", () => {
    expect(parseIdempotencyKey("1234567890abcd\tef").ok).toBe(false);
  });

  it("rejects embedded null bytes", () => {
    expect(parseIdempotencyKey("1234567890abcd\0ef").ok).toBe(false);
  });

  it("rejects keys with disallowed punctuation", () => {
    expect(parseIdempotencyKey("1234567890abcdef!").ok).toBe(false);
    expect(parseIdempotencyKey("1234567890abcdef@").ok).toBe(false);
    expect(parseIdempotencyKey("1234567890abcdef/").ok).toBe(false);
  });

  it("accepts a canonical UUID", () => {
    const result = parseIdempotencyKey("550e8400-e29b-41d4-a716-446655440000");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.key).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("accepts an opaque allowlisted key using every permitted character class", () => {
    expect(parseIdempotencyKey("order.checkout:abc_DEF-123456").ok).toBe(true);
  });

  it("returns the exact original key on success, unmodified", () => {
    const key = "Client-Generated_Key.v1:00001111";
    const result = parseIdempotencyKey(key);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.key).toBe(key);
  });
});

describe("hashIdempotencyKey", () => {
  it("returns a 64-character lowercase hex sha256 digest", () => {
    const digest = hashIdempotencyKey("550e8400-e29b-41d4-a716-446655440000");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same raw key", () => {
    const raw = "order.checkout:abc_DEF-123456";
    expect(hashIdempotencyKey(raw)).toBe(hashIdempotencyKey(raw));
  });

  it("produces different digests for different raw keys", () => {
    const a = hashIdempotencyKey("550e8400-e29b-41d4-a716-446655440000");
    const b = hashIdempotencyKey("660e8400-e29b-41d4-a716-446655440001");
    expect(a).not.toBe(b);
  });

  it("never returns the raw key as a plaintext substring of the digest", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000";
    const digest = hashIdempotencyKey(raw);
    expect(digest).not.toContain(raw);
    expect(digest.includes("550e8400")).toBe(false);
  });

  it("matches an independently computed sha256 hex digest", () => {
    const raw = "abcdefghijklmnopqrstuvwx";
    const expected = createHash("sha256").update(raw, "utf8").digest("hex");
    expect(hashIdempotencyKey(raw)).toBe(expected);
  });

  it("produces digests unaffected by V8 string interning of equal-value keys", () => {
    const literal = "1234567890abcdef";
    const built = ["1234567890", "abcdef"].join("");
    expect(hashIdempotencyKey(literal)).toBe(hashIdempotencyKey(built));
  });
});
