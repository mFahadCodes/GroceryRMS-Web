import { describe, expect, it } from "vitest";
import { buildIdempotencyRequestHash } from "@/lib/security/idempotency";
import {
  ORDER_NOT_VOIDABLE,
  ORDER_VOID_CONFLICT,
} from "@/lib/security/void-concurrency";
import { voidOrderSchema } from "@/lib/validators/order.validators";
import { deterministicApprovalToken } from "./void-test-harness";

describe("void request canonicalization", () => {
  const APPROVAL = deterministicApprovalToken(1);

  it("voidOrderSchema requires reason and managerApprovalToken", () => {
    expect(voidOrderSchema.safeParse({}).success).toBe(false);
    expect(
      voidOrderSchema.safeParse({
        reason: "x",
        managerApprovalToken: APPROVAL,
      }).success,
    ).toBe(true);
  });

  it("voidOrderSchema rejects managerPin and managerUserId", () => {
    expect(
      voidOrderSchema.safeParse({
        reason: "x",
        managerApprovalToken: APPROVAL,
        managerPin: "not-accepted",
      }).success,
    ).toBe(false);
    expect(
      voidOrderSchema.safeParse({
        reason: "x",
        managerApprovalToken: APPROVAL,
        managerUserId: 7,
      }).success,
    ).toBe(false);
  });

  it("defaults reverseStock to false", () => {
    const parsed = voidOrderSchema.parse({
      reason: "x",
      managerApprovalToken: APPROVAL,
    });
    expect(parsed.reverseStock).toBe(false);
  });

  it("identical business payloads produce identical request hashes", () => {
    const base = {
      orderId: 50,
      reason: "customer cancelled",
      reverseStock: false,
    };
    const hashA = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: base,
    });
    const hashB = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: base,
    });
    expect(hashA).toBe(hashB);
  });

  it("reason change alters the request hash", () => {
    const hashA = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: { orderId: 50, reason: "a", reverseStock: false },
    });
    const hashB = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: { orderId: 50, reason: "b", reverseStock: false },
    });
    expect(hashA).not.toBe(hashB);
  });

  it("reverseStock change alters the request hash", () => {
    const hashA = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: { orderId: 50, reason: "a", reverseStock: false },
    });
    const hashB = buildIdempotencyRequestHash({
      operation: "order.void",
      resourceType: "orders",
      resourceId: 50,
      payload: { orderId: 50, reason: "a", reverseStock: true },
    });
    expect(hashA).not.toBe(hashB);
  });

  it("exports stable void conflict codes", () => {
    expect(ORDER_NOT_VOIDABLE).toBe("ORDER_NOT_VOIDABLE");
    expect(ORDER_VOID_CONFLICT).toBe("ORDER_VOID_CONFLICT");
  });
});
