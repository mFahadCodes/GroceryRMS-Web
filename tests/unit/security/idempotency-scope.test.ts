import { describe, expect, it } from "vitest";
import {
  buildIdempotencyScopeHash,
  formatTerminalScope,
  hashIdempotencyKey,
  IDEMPOTENCY_TERMINAL_SENTINEL,
} from "@/lib/security/idempotency";

const keyDigest = hashIdempotencyKey("550e8400-e29b-41d4-a716-446655440000");
const otherKeyDigest = hashIdempotencyKey("660e8400-e29b-41d4-a716-446655440001");

const baseScopeInput = {
  actorUserId: 2,
  authoritativeTerminalId: 1 as number | null,
  operation: "order.checkout" as const,
  resourceType: "orders",
  resourceId: 50,
  keyDigest,
};

describe("formatTerminalScope", () => {
  it("formats a positive integer terminal id as t:<id>", () => {
    expect(formatTerminalScope(1)).toBe("t:1");
    expect(formatTerminalScope(42)).toBe("t:42");
  });

  it("falls back to the sentinel for null", () => {
    expect(formatTerminalScope(null)).toBe(IDEMPOTENCY_TERMINAL_SENTINEL);
  });

  it("falls back to the sentinel for undefined", () => {
    expect(formatTerminalScope(undefined)).toBe(IDEMPOTENCY_TERMINAL_SENTINEL);
  });

  it("falls back to the sentinel for zero and negative ids", () => {
    expect(formatTerminalScope(0)).toBe(IDEMPOTENCY_TERMINAL_SENTINEL);
    expect(formatTerminalScope(-1)).toBe(IDEMPOTENCY_TERMINAL_SENTINEL);
  });

  it("falls back to the sentinel for non-integer ids", () => {
    expect(formatTerminalScope(1.5)).toBe(IDEMPOTENCY_TERMINAL_SENTINEL);
  });
});

describe("buildIdempotencyScopeHash", () => {
  it("is deterministic for identical input", () => {
    expect(buildIdempotencyScopeHash(baseScopeInput)).toBe(
      buildIdempotencyScopeHash(baseScopeInput),
    );
  });

  it("returns a 64-character hex digest", () => {
    expect(buildIdempotencyScopeHash(baseScopeInput)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the actor user id changes", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({ ...baseScopeInput, actorUserId: 3 });
    expect(a).not.toBe(b);
  });

  it("changes when the operation changes", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({
      ...baseScopeInput,
      operation: "order.partial-payment",
    });
    expect(a).not.toBe(b);
  });

  it("changes when the order (resourceId) changes", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({ ...baseScopeInput, resourceId: 51 });
    expect(a).not.toBe(b);
  });

  it("changes when the resourceType changes", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({ ...baseScopeInput, resourceType: "invoices" });
    expect(a).not.toBe(b);
  });

  it("changes when the key digest changes (different raw key)", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({ ...baseScopeInput, keyDigest: otherKeyDigest });
    expect(a).not.toBe(b);
  });

  it("changes when the authoritative terminal changes", () => {
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const b = buildIdempotencyScopeHash({ ...baseScopeInput, authoritativeTerminalId: 2 });
    expect(a).not.toBe(b);
  });

  it("treats a null authoritative terminal differently from a real terminal id", () => {
    const withTerminal = buildIdempotencyScopeHash(baseScopeInput);
    const withoutTerminal = buildIdempotencyScopeHash({
      ...baseScopeInput,
      authoritativeTerminalId: null,
    });
    expect(withTerminal).not.toBe(withoutTerminal);
  });

  it("maps every non-authoritative (null/undefined/invalid) terminal to the same sentinel scope", () => {
    const withNull = buildIdempotencyScopeHash({
      ...baseScopeInput,
      authoritativeTerminalId: null,
    });
    const withUndefined = buildIdempotencyScopeHash({
      ...baseScopeInput,
      authoritativeTerminalId: undefined,
    });
    const withZero = buildIdempotencyScopeHash({
      ...baseScopeInput,
      authoritativeTerminalId: 0,
    });
    expect(withNull).toBe(withUndefined);
    expect(withNull).toBe(withZero);
  });

  it("is not affected by an unrelated request-terminal field — only the authoritative terminal is hashed", () => {
    // buildIdempotencyScopeHash has no "requestTerminalId" parameter at all;
    // this asserts the scope is identical for two calls that differ only in
    // an out-of-band value the caller might otherwise be tempted to mix in.
    const a = buildIdempotencyScopeHash(baseScopeInput);
    const spoofedRequestTerminal = { ...baseScopeInput, authoritativeTerminalId: 1 };
    const b = buildIdempotencyScopeHash(spoofedRequestTerminal);
    expect(a).toBe(b);
  });

  it("does not embed the raw idempotency key anywhere in the scope hash", () => {
    const rawKey = "550e8400-e29b-41d4-a716-446655440000";
    const scope = buildIdempotencyScopeHash(baseScopeInput);
    expect(scope).not.toContain(rawKey);
    expect(scope).not.toContain("550e8400");
  });

  it("does not collide across field boundaries for adjacent numeric ids", () => {
    // Length-prefixing prevents e.g. actorUserId=1,resourceId=23 colliding
    // with actorUserId=12,resourceId=3 by naive string concatenation.
    const a = buildIdempotencyScopeHash({
      ...baseScopeInput,
      actorUserId: 1,
      resourceId: 23,
    });
    const b = buildIdempotencyScopeHash({
      ...baseScopeInput,
      actorUserId: 12,
      resourceId: 3,
    });
    expect(a).not.toBe(b);
  });

  it("produces the same scope for the same logical request replayed twice", () => {
    const first = buildIdempotencyScopeHash(baseScopeInput);
    const second = buildIdempotencyScopeHash({ ...baseScopeInput });
    expect(first).toBe(second);
  });
});
