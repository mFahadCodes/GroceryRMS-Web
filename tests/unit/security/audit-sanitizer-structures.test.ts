import { describe, expect, it } from "vitest";
import {
  AUDIT_CIRCULAR,
  AUDIT_MAX_DEPTH,
  AUDIT_SANITIZER_LIMITS,
  AUDIT_TRUNCATED,
  AUDIT_UNSUPPORTED,
  sanitizeAuditMetadata,
  serializeSafeAuditMetadata,
} from "../../../lib/security/audit-sanitizer";

describe("audit sanitizer structural safety", () => {
  it("handles circular objects without throwing", () => {
    const cyclic: Record<string, unknown> = { ok: true };
    cyclic.self = cyclic;
    expect(() => sanitizeAuditMetadata(cyclic)).not.toThrow();
    const sanitized = sanitizeAuditMetadata(cyclic) as {
      ok: boolean;
      self: string;
    };
    expect(sanitized.ok).toBe(true);
    expect(sanitized.self).toBe(AUDIT_CIRCULAR);
  });

  it("stops at maximum nesting depth", () => {
    let nested: unknown = { leaf: true };
    for (let i = 0; i < AUDIT_SANITIZER_LIMITS.maxDepth + 3; i += 1) {
      nested = { child: nested };
    }
    const sanitized = sanitizeAuditMetadata(nested);
    const json = JSON.stringify(sanitized);
    expect(json).toContain(AUDIT_MAX_DEPTH);
  });

  it("bounds huge arrays", () => {
    const sanitized = sanitizeAuditMetadata({
      rows: Array.from({ length: 200 }, (_, i) => i),
    }) as { rows: unknown[] };
    expect(sanitized.rows.length).toBeLessThanOrEqual(
      AUDIT_SANITIZER_LIMITS.maxArrayEntries + 1,
    );
    expect(sanitized.rows).toContain(AUDIT_TRUNCATED);
  });

  it("bounds huge objects", () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 120; i += 1) input[`k${i}`] = i;
    const sanitized = sanitizeAuditMetadata(input) as Record<string, unknown>;
    expect(Object.keys(sanitized).length).toBeLessThanOrEqual(
      AUDIT_SANITIZER_LIMITS.maxObjectProperties + 1,
    );
    expect(sanitized._truncated).toBe(AUDIT_TRUNCATED);
  });

  it("truncates huge strings", () => {
    const huge = "x".repeat(AUDIT_SANITIZER_LIMITS.maxStringLength + 500);
    const sanitized = sanitizeAuditMetadata({ note: huge }) as { note: string };
    expect(sanitized.note.length).toBeLessThanOrEqual(
      AUDIT_SANITIZER_LIMITS.maxStringLength,
    );
    expect(sanitized.note.endsWith(AUDIT_TRUNCATED)).toBe(true);
  });

  it("bounds final serialized UTF-8 byte size", () => {
    const payload = {
      a: "α".repeat(8000),
      b: "β".repeat(8000),
      c: Array.from({ length: 40 }, () => "γ".repeat(200)),
    };
    const json = serializeSafeAuditMetadata(payload);
    expect(json).toBeTruthy();
    expect(new TextEncoder().encode(json!).byteLength).toBeLessThanOrEqual(
      AUDIT_SANITIZER_LIMITS.maxSerializedBytes,
    );
  });

  it("serializes BigInt as a bounded decimal string", () => {
    const sanitized = sanitizeAuditMetadata({ amount: 10_000n }) as {
      amount: string;
    };
    expect(sanitized.amount).toBe("10000");
  });

  it("serializes Date as ISO", () => {
    const date = new Date("2026-07-21T12:00:00.000Z");
    const sanitized = sanitizeAuditMetadata({ at: date }) as { at: string };
    expect(sanitized.at).toBe("2026-07-21T12:00:00.000Z");
  });

  it("does not persist buffers, functions, or symbols", () => {
    const sanitized = sanitizeAuditMetadata({
      buf: Buffer.from("secret"),
      fn: () => "x",
      sym: Symbol("s"),
    }) as Record<string, unknown>;
    expect(sanitized.buf).toBe(AUDIT_UNSUPPORTED);
    expect(sanitized.fn).toBe(AUDIT_UNSUPPORTED);
    expect(sanitized.sym).toBe(AUDIT_UNSUPPORTED);
  });

  it("ignores prototype properties and does not mutate input", () => {
    const proto = { inherited: "nope", password: "x" };
    const input = Object.create(proto) as Record<string, unknown>;
    input.own = "yes";
    const before = JSON.stringify(Object.getOwnPropertyNames(input));
    const sanitized = sanitizeAuditMetadata(input) as Record<string, unknown>;
    expect(sanitized.own).toBe("yes");
    expect(sanitized.inherited).toBeUndefined();
    expect(sanitized.password).toBeUndefined();
    expect(JSON.stringify(Object.getOwnPropertyNames(input))).toBe(before);
  });

  it("is idempotent and deterministic", () => {
    const input = { note: "hello", nested: { count: 2 } };
    const once = sanitizeAuditMetadata(input);
    const twice = sanitizeAuditMetadata(once);
    expect(twice).toEqual(once);
    expect(serializeSafeAuditMetadata(input)).toBe(
      serializeSafeAuditMetadata(input),
    );
  });

  it("never returns the original mutable object", () => {
    const input = { note: "hello" };
    const sanitized = sanitizeAuditMetadata(input) as { note: string };
    expect(sanitized).not.toBe(input);
    sanitized.note = "changed";
    expect(input.note).toBe("hello");
  });
});
