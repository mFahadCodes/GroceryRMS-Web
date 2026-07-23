import { describe, expect, it } from "vitest";
import {
  abandonFinancialAttempt,
  prepareFinancialAttempt,
} from "@/lib/financial-idempotency/lifecycle";
import { fingerprintFinancialBusinessPayload } from "@/lib/financial-idempotency/fingerprint";
import { buildCheckoutBusinessPayload } from "@/lib/financial-idempotency/operations";
import { readFinancialAttempt } from "@/lib/financial-idempotency/storage";
import { useFinancialIdempotencyTestHarness } from "./financial-idempotency-test-harness";

describe("financial attempt lifecycle", () => {
  useFinancialIdempotencyTestHarness();

  async function fingerprintFor(tendered: bigint) {
    const payload = buildCheckoutBusinessPayload({
      orderId: 11,
      paymentMethodId: 1,
      tenderedAmount: tendered,
      terminalId: 2,
    });
    return fingerprintFinancialBusinessPayload("order.checkout", payload);
  }

  it("creates a new key for a genuinely new attempt", async () => {
    const fingerprint = await fingerprintFor(1000n);
    const prepared = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.reusedKey).toBe(false);
    expect(prepared.attempt.key.length).toBeGreaterThanOrEqual(16);
  });

  it("reuses the same key for same-fingerprint retries", async () => {
    const fingerprint = await fingerprintFor(1000n);
    const first = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reusedKey).toBe(true);
    expect(second.attempt.key).toBe(first.attempt.key);
  });

  it("blocks changed payloads from reusing an uncertain key", async () => {
    const firstFingerprint = await fingerprintFor(1000n);
    const first = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint: firstFingerprint,
    });
    expect(first.ok).toBe(true);
    const secondFingerprint = await fingerprintFor(2000n);
    const blocked = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint: secondFingerprint,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe("fingerprint_mismatch");
    expect(readFinancialAttempt("order.checkout", 11)?.key).toBe(
      first.ok ? first.attempt.key : "",
    );
  });

  it("requires explicit abandonment before a new key can be minted", async () => {
    const fingerprint = await fingerprintFor(1000n);
    const first = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint,
    });
    expect(first.ok).toBe(true);
    abandonFinancialAttempt("order.checkout", 11);
    const nextFingerprint = await fingerprintFor(2000n);
    const second = prepareFinancialAttempt({
      operation: "order.checkout",
      resourceId: 11,
      fingerprint: nextFingerprint,
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reusedKey).toBe(false);
    expect(second.attempt.key).not.toBe(first.attempt.key);
  });
});
