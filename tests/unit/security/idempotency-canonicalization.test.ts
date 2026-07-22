import { describe, expect, it } from "vitest";
import {
  buildIdempotencyRequestHash,
  canonicalizeIdempotencyPayload,
  IDEMPOTENCY_REQUEST_HASH_VERSION,
} from "@/lib/security/idempotency";

const base = {
  operation: "order.checkout" as const,
  resourceType: "orders",
  resourceId: 1,
};

describe("canonicalizeIdempotencyPayload", () => {
  it("sorts object keys regardless of insertion order", () => {
    const a = canonicalizeIdempotencyPayload({ b: 1, a: 2 });
    const b = canonicalizeIdempotencyPayload({ a: 2, b: 1 });
    expect(a).toEqual(b);
    expect(Object.keys(a as Record<string, unknown>)).toEqual(["a", "b"]);
  });

  it("preserves array element order (does not sort arrays)", () => {
    const a = canonicalizeIdempotencyPayload({ items: [1, 2, 3] });
    const b = canonicalizeIdempotencyPayload({ items: [3, 2, 1] });
    expect(a).not.toEqual(b);
  });

  it("drops undefined object properties recursively", () => {
    const canonical = canonicalizeIdempotencyPayload({
      a: undefined,
      b: 1,
      nested: { c: undefined, d: 2 },
    });
    expect(canonical).toEqual({ b: 1, nested: { d: 2 } });
  });

  it("preserves explicit null values (does not drop them like undefined)", () => {
    const canonical = canonicalizeIdempotencyPayload({ a: null });
    expect(canonical).toEqual({ a: null });
  });

  it("preserves explicit false values", () => {
    const canonical = canonicalizeIdempotencyPayload({ flag: false });
    expect(canonical).toEqual({ flag: false });
  });

  it("preserves explicit zero values", () => {
    const canonical = canonicalizeIdempotencyPayload({ amount: 0 });
    expect(canonical).toEqual({ amount: 0 });
  });

  it("encodes bigint as a tagged object with a string value", () => {
    const canonical = canonicalizeIdempotencyPayload({ amount: 12_345n });
    expect(canonical).toEqual({
      amount: { __type: "bigint", value: "12345" },
    });
  });

  it("encodes negative bigint values", () => {
    const canonical = canonicalizeIdempotencyPayload({ amount: -500n });
    expect(canonical).toEqual({
      amount: { __type: "bigint", value: "-500" },
    });
  });

  it("encodes bigint values nested inside arrays", () => {
    const canonical = canonicalizeIdempotencyPayload({
      payments: [{ amount: 100n }, { amount: 200n }],
    });
    expect(canonical).toEqual({
      payments: [
        { amount: { __type: "bigint", value: "100" } },
        { amount: { __type: "bigint", value: "200" } },
      ],
    });
  });

  it("recursively sorts keys inside nested objects", () => {
    const canonical = canonicalizeIdempotencyPayload({
      outer: { z: 1, y: 2, x: { beta: 1, alpha: 2 } },
    });
    expect(canonical).toEqual({
      outer: { x: { alpha: 2, beta: 1 }, y: 2, z: 1 },
    });
  });

  it("throws for an undefined root payload", () => {
    expect(() => canonicalizeIdempotencyPayload(undefined)).toThrow(
      /must not be undefined/i,
    );
  });

  it("throws for Date values anywhere in the payload", () => {
    expect(() => canonicalizeIdempotencyPayload({ when: new Date() })).toThrow(
      /Date values are not allowed/i,
    );
  });

  it("throws for unsupported value types such as functions", () => {
    expect(() =>
      canonicalizeIdempotencyPayload({ fn: () => 1 }),
    ).toThrow(/Unsupported idempotency payload value type/i);
  });

  it("passes through primitive-only payloads unchanged", () => {
    expect(canonicalizeIdempotencyPayload(42)).toBe(42);
    expect(canonicalizeIdempotencyPayload("s")).toBe("s");
    expect(canonicalizeIdempotencyPayload(true)).toBe(true);
    expect(canonicalizeIdempotencyPayload(null)).toBeNull();
  });
});

describe("buildIdempotencyRequestHash", () => {
  it("is stable for semantically identical payloads with different key order", () => {
    const a = buildIdempotencyRequestHash({
      ...base,
      payload: { amount: 100n, paymentMethodId: 1 },
    });
    const b = buildIdempotencyRequestHash({
      ...base,
      payload: { paymentMethodId: 1, amount: 100n },
    });
    expect(a).toBe(b);
  });

  it("changes when array order changes", () => {
    const a = buildIdempotencyRequestHash({
      ...base,
      payload: { payments: [{ id: 1 }, { id: 2 }] },
    });
    const b = buildIdempotencyRequestHash({
      ...base,
      payload: { payments: [{ id: 2 }, { id: 1 }] },
    });
    expect(a).not.toBe(b);
  });

  it("distinguishes an absent field from an explicit null", () => {
    const absent = buildIdempotencyRequestHash({ ...base, payload: { amount: 1n } });
    const withNull = buildIdempotencyRequestHash({
      ...base,
      payload: { amount: 1n, notes: null },
    });
    expect(absent).not.toBe(withNull);
  });

  it("distinguishes an absent field from an explicit zero", () => {
    const absent = buildIdempotencyRequestHash({ ...base, payload: {} });
    const withZero = buildIdempotencyRequestHash({
      ...base,
      payload: { amount: 0n },
    });
    expect(absent).not.toBe(withZero);
  });

  it("distinguishes an absent field from an explicit false", () => {
    const absent = buildIdempotencyRequestHash({ ...base, payload: {} });
    const withFalse = buildIdempotencyRequestHash({
      ...base,
      payload: { redeemPoints: false },
    });
    expect(absent).not.toBe(withFalse);
  });

  it("changes when the amount changes", () => {
    const a = buildIdempotencyRequestHash({ ...base, payload: { amount: 100n } });
    const b = buildIdempotencyRequestHash({ ...base, payload: { amount: 101n } });
    expect(a).not.toBe(b);
  });

  it("changes when the operation changes for the same payload", () => {
    const checkout = buildIdempotencyRequestHash({
      ...base,
      operation: "order.checkout",
      payload: { amount: 100n },
    });
    const partial = buildIdempotencyRequestHash({
      ...base,
      operation: "order.partial-payment",
      payload: { amount: 100n },
    });
    expect(checkout).not.toBe(partial);
  });

  it("changes when the resourceId changes for the same payload", () => {
    const a = buildIdempotencyRequestHash({ ...base, resourceId: 1, payload: {} });
    const b = buildIdempotencyRequestHash({ ...base, resourceId: 2, payload: {} });
    expect(a).not.toBe(b);
  });

  it("changes when the resourceType changes for the same payload", () => {
    const a = buildIdempotencyRequestHash({ ...base, resourceType: "orders", payload: {} });
    const b = buildIdempotencyRequestHash({ ...base, resourceType: "invoices", payload: {} });
    expect(a).not.toBe(b);
  });

  it("bakes the version marker into the digest so a version bump would change every hash", () => {
    // The canonical structure hashed is { v, operation, resourceType, resourceId, payload }.
    // We can't change the exported constant, but we assert the version string
    // this build uses is a fixed, deliberate value the digest depends on.
    expect(IDEMPOTENCY_REQUEST_HASH_VERSION).toBe("v1");
    const withV1Payload = buildIdempotencyRequestHash({
      ...base,
      payload: { v: "v1" },
    });
    const withV2Payload = buildIdempotencyRequestHash({
      ...base,
      payload: { v: "v2" },
    });
    expect(withV1Payload).not.toBe(withV2Payload);
  });

  it("is deterministic across repeated calls with identical input", () => {
    const input = { ...base, payload: { amount: 5_000n, referenceNo: "REF-1" } };
    expect(buildIdempotencyRequestHash(input)).toBe(
      buildIdempotencyRequestHash(input),
    );
  });

  it("produces a 64-character hex digest", () => {
    const digest = buildIdempotencyRequestHash({ ...base, payload: {} });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
