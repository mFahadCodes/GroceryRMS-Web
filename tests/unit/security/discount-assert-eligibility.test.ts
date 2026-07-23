import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import {
  assertOrderDiscountable,
  ORDER_NOT_DISCOUNTABLE,
} from "@/lib/security/discount-concurrency";
import { buildIdempotencyRequestHash } from "@/lib/security/idempotency";

describe("discount eligibility assertions and request digests", () => {
  it("assertOrderDiscountable accepts Open", () => {
    expect(() => assertOrderDiscountable("Open")).not.toThrow();
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
    "Delivered",
    "Closed",
    "Void",
  ] as const)("assertOrderDiscountable rejects %s", (status) => {
    try {
      assertOrderDiscountable(status);
      expect.unreachable("expected assertOrderDiscountable to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        code: ORDER_NOT_DISCOUNTABLE,
        status: 409,
      });
    }
  });

  it("different orderIds produce different discount request digests", () => {
    const a = buildIdempotencyRequestHash({
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
    const b = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 2,
      payload: {
        orderId: 2,
        discountAmount: 100n,
        discountPercent: null,
        reason: null,
      },
    });
    expect(a).not.toBe(b);
  });

  it("discountAmount null versus 0n are distinct digests", () => {
    const withNull = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: null,
        discountPercent: 10,
        reason: null,
      },
    });
    const withZero = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: 0n,
        discountPercent: 10,
        reason: null,
      },
    });
    expect(withNull).not.toBe(withZero);
  });

  it("excludes idempotency key and actor identity from the business digest", () => {
    const base = {
      operation: "order.discount" as const,
      resourceType: "orders" as const,
      resourceId: 9,
      payload: {
        orderId: 9,
        discountAmount: 250n,
        discountPercent: null,
        reason: "manager courtesy",
      },
    };
    const polluted = {
      ...base,
      payload: {
        ...base.payload,
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        actorUserId: 2,
        terminalId: 1,
        managerPin: "9999",
      },
    };
    expect(buildIdempotencyRequestHash(base)).not.toBe(
      buildIdempotencyRequestHash(polluted),
    );
  });

  it("percent-only and amount-only payloads with equal numeric intent remain distinct", () => {
    const amount = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: 1_000n,
        discountPercent: null,
        reason: null,
      },
    });
    const percent = buildIdempotencyRequestHash({
      operation: "order.discount",
      resourceType: "orders",
      resourceId: 1,
      payload: {
        orderId: 1,
        discountAmount: null,
        discountPercent: 10,
        reason: null,
      },
    });
    expect(amount).not.toBe(percent);
  });
});
