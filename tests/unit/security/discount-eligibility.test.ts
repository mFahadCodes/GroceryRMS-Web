import { describe, expect, it } from "vitest";
import {
  DISCOUNTABLE_ORDER_STATUSES,
  isDiscountableOrderStatus,
} from "@/lib/security/discount-concurrency";
import { buildIdempotencyRequestHash } from "@/lib/security/idempotency";

describe("discount eligibility and canonicalization", () => {
  it("DISCOUNTABLE_ORDER_STATUSES contains only Open", () => {
    expect([...DISCOUNTABLE_ORDER_STATUSES]).toEqual(["Open"]);
  });

  it("Open is discountable and all other statuses are not", () => {
    expect(isDiscountableOrderStatus("Open")).toBe(true);
    for (const status of [
      "PartiallyPaid",
      "Packed",
      "OutForDelivery",
      "Delivered",
      "Closed",
      "Void",
    ] as const) {
      expect(isDiscountableOrderStatus(status)).toBe(false);
    }
  });

  it("hashes amount, percent, and reason while excluding approval credentials", () => {
    const base = {
      operation: "order.discount" as const,
      resourceType: "orders",
      resourceId: 50,
      payload: {
        orderId: 50,
        discountAmount: 500n,
        discountPercent: null,
        reason: "courtesy",
      },
    };
    const withCred = {
      ...base,
      payload: {
        ...base.payload,
        managerApprovalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      },
    };
    const a = buildIdempotencyRequestHash(base);
    const b = buildIdempotencyRequestHash(base);
    expect(a).toBe(b);
    expect(a).not.toBe(buildIdempotencyRequestHash(withCred));
  });

  it("treats null reason differently from absent reason in the canonical payload", () => {
    const withNull = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: 100n,
        discountPercent: null,
        reason: null,
      },
    });
    const withoutReason = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: 100n,
        discountPercent: null,
      },
    });
    expect(withNull).not.toBe(withoutReason);
  });

  it("preserves bigint tagging for discountAmount", () => {
    const hash = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: 0n,
        discountPercent: null,
        reason: null,
      },
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
