import { describe, expect, it } from "vitest";
import {
  assertRefundWithinRemaining,
  remainingRefundableAmount,
  REFUND_EXCEEDS_REFUNDABLE_AMOUNT,
  RETURN_HISTORY_RECONCILIATION_REQUIRED,
  RETURN_QUANTITY_EXCEEDS_REMAINING,
} from "@/lib/security/refund-return-concurrency";
import { ServiceError } from "@/lib/api/service-error";

describe("refund/return concurrency policy helpers", () => {
  it("computes remaining refundable amount", () => {
    expect(remainingRefundableAmount(10_000n, 0n)).toBe(10_000n);
    expect(remainingRefundableAmount(10_000n, 4_000n)).toBe(6_000n);
    expect(remainingRefundableAmount(10_000n, 10_000n)).toBe(0n);
    expect(remainingRefundableAmount(10_000n, 12_000n)).toBe(0n);
  });

  it("rejects refund above remaining with 409", () => {
    try {
      assertRefundWithinRemaining(5_001n, 5_000n);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      if (error instanceof ServiceError) {
        expect(error.status).toBe(409);
        expect(error.code).toBe(REFUND_EXCEEDS_REFUNDABLE_AMOUNT);
      }
    }
  });

  it("exports stable conflict codes", () => {
    expect(RETURN_QUANTITY_EXCEEDS_REMAINING).toBe(
      "RETURN_QUANTITY_EXCEEDS_REMAINING",
    );
    expect(RETURN_HISTORY_RECONCILIATION_REQUIRED).toBe(
      "RETURN_HISTORY_RECONCILIATION_REQUIRED",
    );
  });
});

describe("return item array canonicalization", () => {
  it("sorts by orderItemId without combining quantities", () => {
    const items = [
      { orderItemId: 3, returnQty: 1, reason: "a" },
      { orderItemId: 1, returnQty: 2, reason: "b" },
      { orderItemId: 2, returnQty: 1, reason: "c" },
    ];
    const sorted = [...items].sort((a, b) => a.orderItemId - b.orderItemId);
    expect(sorted.map((i) => i.orderItemId)).toEqual([1, 2, 3]);
    expect(sorted[0]?.returnQty).toBe(2);
  });
});
