import { describe, expect, it } from "vitest";
import { calculateShiftCloseTotals } from "../../../lib/services/shift-service";

describe("shift close financial invariants", () => {
  it("expected balance equals opening when there are no cash drawer logs", () => {
    const totals = calculateShiftCloseTotals(10_000n, [], 10_000n);
    expect(totals).toEqual({
      cashSales: 0n,
      payIns: 0n,
      payOuts: 0n,
      cashRefunds: 0n,
      expectedBalance: 10_000n,
      discrepancy: 0n,
    });
  });

  it("adds [CASH] Sale amounts to expected balance", () => {
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        {
          type: "Sale",
          description: "[CASH] ORD-1 (Cash)",
          amount: 2_500n,
        },
      ],
      12_500n,
    );
    expect(totals.cashSales).toBe(2_500n);
    expect(totals.expectedBalance).toBe(12_500n);
    expect(totals.discrepancy).toBe(0n);
  });

  it("adds PayIn and subtracts PayOut", () => {
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        { type: "PayIn", description: "float top-up", amount: 1_000n },
        { type: "PayOut", description: "petty cash", amount: 400n },
      ],
      10_600n,
    );
    expect(totals.payIns).toBe(1_000n);
    expect(totals.payOuts).toBe(400n);
    expect(totals.expectedBalance).toBe(10_600n);
    expect(totals.discrepancy).toBe(0n);
  });

  it("subtracts [CASH] Refund amounts", () => {
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        {
          type: "Refund",
          description: "[CASH] Refund for ORD-2 (Cash)",
          amount: 750n,
        },
      ],
      9_250n,
    );
    expect(totals.cashRefunds).toBe(750n);
    expect(totals.expectedBalance).toBe(9_250n);
    expect(totals.discrepancy).toBe(0n);
  });

  it("applies the full historical formula with mixed cash movements", () => {
    // opening + cashSales + payIns - payOuts - cashRefunds
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        {
          type: "Sale",
          description: "[CASH] ORD-10 (Cash)",
          amount: 3_000n,
        },
        {
          type: "Sale",
          description: "[CASH] ORD-11 (Cash)",
          amount: 1_500n,
        },
        { type: "PayIn", description: "bank drop reverse", amount: 200n },
        { type: "PayOut", description: "change order", amount: 100n },
        {
          type: "Refund",
          description: "[CASH] Refund for ORD-10 (Cash)",
          amount: 500n,
        },
      ],
      14_150n,
    );
    expect(totals.cashSales).toBe(4_500n);
    expect(totals.payIns).toBe(200n);
    expect(totals.payOuts).toBe(100n);
    expect(totals.cashRefunds).toBe(500n);
    expect(totals.expectedBalance).toBe(14_100n);
    expect(totals.discrepancy).toBe(50n);
  });

  it("ignores non-cash Sale descriptions", () => {
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        {
          type: "Sale",
          description: "[NONCASH] ORD-20 (Card)",
          amount: 9_999n,
        },
        {
          type: "Sale",
          description: "ORD-21 without prefix",
          amount: 100n,
        },
      ],
      10_000n,
    );
    expect(totals.cashSales).toBe(0n);
    expect(totals.expectedBalance).toBe(10_000n);
  });

  it("ignores non-cash Refund descriptions", () => {
    const totals = calculateShiftCloseTotals(
      10_000n,
      [
        {
          type: "Refund",
          description: "[NONCASH] Refund for ORD-30 (Card)",
          amount: 4_000n,
        },
        {
          type: "Refund",
          description: "Refund missing cash marker",
          amount: 50n,
        },
      ],
      10_000n,
    );
    expect(totals.cashRefunds).toBe(0n);
    expect(totals.expectedBalance).toBe(10_000n);
  });

  it("ignores Tip entries even when present", () => {
    const totals = calculateShiftCloseTotals(
      5_000n,
      [{ type: "Tip", description: "tip jar", amount: 300n }],
      5_000n,
    );
    expect(totals.expectedBalance).toBe(5_000n);
    expect(totals.cashSales).toBe(0n);
    expect(totals.payIns).toBe(0n);
  });

  it("treats Sale without description as non-cash", () => {
    const totals = calculateShiftCloseTotals(
      1_000n,
      [{ type: "Sale", description: null, amount: 500n }],
      1_000n,
    );
    expect(totals.cashSales).toBe(0n);
    expect(totals.expectedBalance).toBe(1_000n);
  });

  it("discrepancy equals closingBalance minus expectedBalance", () => {
    const totals = calculateShiftCloseTotals(
      8_000n,
      [
        {
          type: "Sale",
          description: "[CASH] ORD-40 (Cash)",
          amount: 2_000n,
        },
      ],
      9_500n,
    );
    expect(totals.expectedBalance).toBe(10_000n);
    expect(totals.discrepancy).toBe(-500n);
    expect(totals.discrepancy).toBe(9_500n - totals.expectedBalance);
  });

  it("uses exact bigint math for large amounts", () => {
    const opening = 9_000_000_000_000_000n;
    const sale = 700_000_000_000_000n;
    const refund = 50_000_000_000_000n;
    const closing = opening + sale - refund + 3n;
    const totals = calculateShiftCloseTotals(
      opening,
      [
        {
          type: "Sale",
          description: "[CASH] ORD-big (Cash)",
          amount: sale,
        },
        {
          type: "Refund",
          description: "[CASH] Refund for ORD-big (Cash)",
          amount: refund,
        },
      ],
      closing,
    );
    expect(totals.expectedBalance).toBe(opening + sale - refund);
    expect(totals.discrepancy).toBe(3n);
    expect(typeof totals.expectedBalance).toBe("bigint");
    expect(typeof totals.discrepancy).toBe("bigint");
  });

  it("sums multiple cash sales and refunds independently", () => {
    const totals = calculateShiftCloseTotals(
      0n,
      [
        {
          type: "Sale",
          description: "[CASH] A (Cash)",
          amount: 100n,
        },
        {
          type: "Sale",
          description: "[CASH] B (Cash)",
          amount: 200n,
        },
        {
          type: "Refund",
          description: "[CASH] Refund for A (Cash)",
          amount: 40n,
        },
        {
          type: "Refund",
          description: "[CASH] Refund for B (Cash)",
          amount: 10n,
        },
      ],
      250n,
    );
    expect(totals.cashSales).toBe(300n);
    expect(totals.cashRefunds).toBe(50n);
    expect(totals.expectedBalance).toBe(250n);
    expect(totals.discrepancy).toBe(0n);
  });
});
