import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import {
  assertPaymentWithinRemaining,
  ORDER_FINANCIAL_CONFLICT,
  ORDER_NOT_OPEN,
  ORDER_NOT_PAYABLE,
  PAYMENT_EXCEEDS_REMAINING,
  remainingBalance,
  sumPaymentAmounts,
} from "@/lib/security/order-financial-concurrency";

describe("order financial concurrency policy helpers", () => {
  it("sums payment amounts exactly", () => {
    expect(sumPaymentAmounts([{ amount: 100n }, { amount: 250n }])).toBe(350n);
  });

  it("sums an empty payment list to 0", () => {
    expect(sumPaymentAmounts([])).toBe(0n);
  });

  it("computes remaining when unpaid", () => {
    expect(remainingBalance(10_000n, 0n)).toBe(10_000n);
  });

  it("computes remaining after a partial", () => {
    expect(remainingBalance(10_000n, 4_000n)).toBe(6_000n);
  });

  it("clamps remaining at zero when paid equals total", () => {
    expect(remainingBalance(10_000n, 10_000n)).toBe(0n);
  });

  it("clamps remaining at zero when paid exceeds total", () => {
    expect(remainingBalance(10_000n, 12_000n)).toBe(0n);
  });

  it("allows a payment equal to remaining", () => {
    expect(() => assertPaymentWithinRemaining(6_000n, 6_000n)).not.toThrow();
  });

  it("allows a payment below remaining", () => {
    expect(() => assertPaymentWithinRemaining(1n, 6_000n)).not.toThrow();
  });

  it("rejects a payment above remaining with 409 PAYMENT_EXCEEDS_REMAINING", () => {
    try {
      assertPaymentWithinRemaining(6_001n, 6_000n);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      if (error instanceof ServiceError) {
        expect(error.status).toBe(409);
        expect(error.code).toBe(PAYMENT_EXCEEDS_REMAINING);
        expect(error.message).toMatch(/exceeds remaining/i);
      }
    }
  });

  it("exports stable conflict codes used by CAS helpers", () => {
    expect(ORDER_NOT_OPEN).toBe("ORDER_NOT_OPEN");
    expect(ORDER_NOT_PAYABLE).toBe("ORDER_NOT_PAYABLE");
    expect(ORDER_FINANCIAL_CONFLICT).toBe("ORDER_FINANCIAL_CONFLICT");
    expect(PAYMENT_EXCEEDS_REMAINING).toBe("PAYMENT_EXCEEDS_REMAINING");
  });
});
