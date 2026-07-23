import { describe, expect, it, vi } from "vitest";
import { createFinancialIdempotencyKey } from "@/lib/financial-idempotency/key";
import {
  FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  FINANCIAL_IDEMPOTENCY_KEY_PATTERN,
} from "@/lib/financial-idempotency/constants";

describe("createFinancialIdempotencyKey", () => {
  it("prefers crypto.randomUUID when available", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    vi.stubGlobal("crypto", {
      randomUUID: () => uuid,
      getRandomValues: (bytes: Uint8Array) => bytes,
    });
    expect(createFinancialIdempotencyKey()).toBe(uuid);
  });

  it("falls back to getRandomValues with at least 16 bytes", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        expect(bytes.byteLength).toBeGreaterThanOrEqual(16);
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1;
        return bytes;
      },
    });
    const key = createFinancialIdempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(FINANCIAL_IDEMPOTENCY_KEY_MIN_LENGTH);
    expect(key.length).toBeLessThanOrEqual(FINANCIAL_IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(FINANCIAL_IDEMPOTENCY_KEY_PATTERN.test(key)).toBe(true);
  });

  it("fails closed when Web Crypto random APIs are missing", () => {
    vi.stubGlobal("crypto", {});
    expect(() => createFinancialIdempotencyKey()).toThrow(/Secure Web Crypto/i);
  });

  it("never uses Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    createFinancialIdempotencyKey();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("produces distinct keys across calls", () => {
    const a = createFinancialIdempotencyKey();
    const b = createFinancialIdempotencyKey();
    expect(a).not.toBe(b);
  });
});
