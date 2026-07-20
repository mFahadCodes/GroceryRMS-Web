import { describe, expect, it } from "vitest";

import { calculatePaisaTotals } from "../../lib/paisa-math";

describe("calculatePaisaTotals", () => {
  it("returns the subtotal unchanged when no adjustments apply", () => {
    expect(calculatePaisaTotals({ subTotal: 10_000n })).toEqual({
      subTotal: 10_000n,
      discountAmount: 0n,
      taxBase: 10_000n,
      taxAmount: 0n,
      serviceCharge: 0n,
      adjustment: 0n,
      grandTotal: 10_000n,
    });
  });

  it("uses an explicit discount amount before a discount percentage", () => {
    const result = calculatePaisaTotals({
      subTotal: 10_000n,
      discountAmount: 750n,
      discountPercent: 50,
    });

    expect(result.discountAmount).toBe(750n);
    expect(result.grandTotal).toBe(9_250n);
  });

  it("adds exclusive tax to the grand total", () => {
    const result = calculatePaisaTotals({
      subTotal: 10_000n,
      taxPercent: 10,
    });

    expect(result.taxAmount).toBe(1_000n);
    expect(result.grandTotal).toBe(11_000n);
  });

  it("extracts inclusive tax without adding it again", () => {
    const result = calculatePaisaTotals({
      subTotal: 11_000n,
      taxPercent: 10,
      isInclusive: true,
    });

    expect(result.taxAmount).toBe(1_000n);
    expect(result.grandTotal).toBe(11_000n);
  });

  it("applies a fixed service charge before the final adjustment", () => {
    const result = calculatePaisaTotals({
      subTotal: 5_000n,
      serviceChargeAmount: 250n,
      adjustment: -50n,
    });

    expect(result.serviceCharge).toBe(250n);
    expect(result.adjustment).toBe(-50n);
    expect(result.grandTotal).toBe(5_200n);
  });

  it("treats non-finite and non-positive percentages as zero", () => {
    const result = calculatePaisaTotals({
      subTotal: 5_000n,
      discountPercent: Number.NaN,
      taxPercent: -10,
      serviceChargePercent: Number.POSITIVE_INFINITY,
    });

    expect(result.grandTotal).toBe(5_000n);
  });
});
