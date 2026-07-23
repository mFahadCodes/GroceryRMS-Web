import { describe, expect, it } from "vitest";
import { calculatePaisaTotals } from "@/lib/paisa-math";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("discount formula invariants remain unchanged", () => {
  it("fixed discount subtracts from subtotal before exclusive tax", () => {
    const totals = calculatePaisaTotals({
      subTotal: 10_000n,
      discountAmount: 1_000n,
      taxPercent: 10,
      isInclusive: false,
    });
    expect(totals.discountAmount).toBe(1_000n);
    expect(totals.taxBase).toBe(9_000n);
    expect(totals.taxAmount).toBe(900n);
    expect(totals.grandTotal).toBe(9_900n);
  });

  it("percent discount uses the existing paisa percentAmount rounding", () => {
    const totals = calculatePaisaTotals({
      subTotal: 10_000n,
      discountPercent: 10,
      taxPercent: 0,
    });
    expect(totals.discountAmount).toBe(1_000n);
    expect(totals.grandTotal).toBe(9_000n);
  });

  it("zero discount leaves the tax base equal to subtotal", () => {
    const totals = calculatePaisaTotals({
      subTotal: 10_000n,
      discountAmount: 0n,
      taxPercent: 5,
      isInclusive: false,
    });
    expect(totals.discountAmount).toBe(0n);
    expect(totals.taxBase).toBe(10_000n);
    expect(totals.taxAmount).toBe(500n);
    expect(totals.grandTotal).toBe(10_500n);
  });

  it("applyOrderDiscount still delegates to calculatePaisaTotals and capOrderDiscountAmount", () => {
    const service = readFileSync(
      path.resolve("lib/services/order-service.ts"),
      "utf8",
    );
    const start = service.indexOf("export async function applyOrderDiscount");
    const next = service.indexOf("\nexport async function", start + 1);
    const block = service.slice(start, next === -1 ? undefined : next);
    expect(block).toContain("calculatePaisaTotals({");
    expect(block).toContain("capOrderDiscountAmount(");
    expect(block).not.toContain("Math.round(discount");
    expect(block).not.toContain("returnedQuantity");
    expect(block).not.toContain("sourceOrderItemId");
  });

  it("does not introduce payment, refund, or return mutation helpers into discount CAS", () => {
    const concurrency = readFileSync(
      path.resolve("lib/security/discount-concurrency.ts"),
      "utf8",
    );
    expect(concurrency).not.toContain("prisma.payment");
    expect(concurrency).not.toContain("applyRefund");
    expect(concurrency).not.toContain("returnedQuantity");
    expect(concurrency).not.toContain("sourceOrderItemId");
    expect(concurrency).not.toContain("stockMovement");
    expect(concurrency).toContain("discountAmount");
    expect(concurrency).toContain("taxAmount");
    expect(concurrency).toContain("grandTotal");
  });
});
