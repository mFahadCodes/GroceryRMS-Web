import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dialog-level contract checks without RTL (node environment, no new deps).
 * Behavioral coverage lives in checkout-financial-idempotency + executor suites.
 */
describe("CheckoutDialog idempotency wiring", () => {
  const source = readFileSync(
    path.resolve("components/pos/CheckoutDialog.tsx"),
    "utf8",
  );

  it("disables submit while busy and while a recovery attempt is retained", () => {
    expect(source).toContain("disabled={submitting || Boolean(recoveryAttempt)}");
    expect(source).toContain("submitLockRef");
    expect(source).toContain("if (submitLockRef.current || submitting) return");
  });

  it("blocks new sales until retained attempts are retried or abandoned", () => {
    expect(source).toContain("if (recoveryAttempt)");
    expect(source).toContain("Abandon attempt");
    expect(source).toContain("Retry retained attempt");
  });

  it("refreshes authoritative order state on conflict reconciliation", () => {
    expect(source).toContain("requiresOrderRefresh");
    expect(source).toContain("`/api/orders/${orderId}`");
    expect(source).toContain("Refresh order status");
  });

  it("keeps receipt and totals behavior intact", () => {
    expect(source).toContain("finalizeSale");
    expect(source).toContain("formatPKR(grandTotal)");
    expect(source).toContain("printReceipt");
    expect(source).toContain("cartTotals");
  });

  it("exposes accessible busy and alert semantics", () => {
    expect(source).toContain("aria-busy={submitting}");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="polite"');
  });

  it("never renders the raw idempotency key", () => {
    expect(source).not.toMatch(/recoveryAttempt\.key/);
    expect(source).not.toMatch(/Idempotency-Key/);
    expect(source).not.toMatch(/attempt\.key/);
  });
});
