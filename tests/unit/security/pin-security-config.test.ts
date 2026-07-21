import { describe, expect, it } from "vitest";
import {
  getPinPepper,
  PIN_SECURITY_DOMAINS,
  PIN_SECURITY_POLICY,
} from "../../../lib/security/pin-security-config";

describe("PIN security configuration", () => {
  it("fails closed when PIN_PEPPER is missing", () => {
    expect(() => getPinPepper({ NODE_ENV: "production" })).toThrow(
      "PIN security configuration is unavailable",
    );
  });
  it("rejects a pepper shorter than 32 UTF-8 bytes", () => {
    expect(() =>
      getPinPepper({ NODE_ENV: "production", PIN_PEPPER: "short" }),
    ).toThrow();
  });
  it.each(["x".repeat(40), "change-me-please-".repeat(3), "your-secret-placeholder-value-123456789"])(
    "rejects an unsafe production value",
    (value) => {
      expect(() =>
        getPinPepper({ NODE_ENV: "production", PIN_PEPPER: value }),
      ).toThrow();
    },
  );
  it("accepts an explicit test-only value in test mode", () => {
    expect(
      getPinPepper({
        NODE_ENV: "test",
        PIN_PEPPER: "test-only-explicit-pin-pepper-value-123456789",
      }).byteLength,
    ).toBeGreaterThanOrEqual(32);
  });
  it("never includes the rejected pepper in its error", () => {
    const value = "your-secret-placeholder-value-123456789";
    try {
      getPinPepper({ NODE_ENV: "production", PIN_PEPPER: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });
  it("uses distinct domains for hashes and both throttle scopes", () => {
    expect(new Set(Object.values(PIN_SECURITY_DOMAINS)).size).toBe(3);
  });
  it("uses the approved bcrypt cost and bounded cleanup", () => {
    expect(PIN_SECURITY_POLICY.bcryptCost).toBe(12);
    expect(PIN_SECURITY_POLICY.cleanupBatchSize).toBeGreaterThan(0);
    expect(PIN_SECURITY_POLICY.cleanupBatchSize).toBeLessThanOrEqual(100);
  });
});
