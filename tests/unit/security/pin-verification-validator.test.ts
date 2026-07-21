import { describe, expect, it } from "vitest";
import {
  loginBodySchema,
  validatePinSchema,
} from "../../../lib/validators/auth.validators";
import {
  applyOrderDiscountSchema,
  voidOrderSchema,
} from "../../../lib/validators/order.validators";

describe("explicit PIN request contracts", () => {
  it("accepts explicit userId plus PIN login", () => {
    expect(loginBodySchema.safeParse({ userId: 7, pin: "4826" }).success).toBe(true);
  });
  it("rejects anonymous PIN-only login", () => {
    expect(loginBodySchema.safeParse({ pin: "4826" }).success).toBe(false);
  });
  it("preserves password login", () => {
    expect(loginBodySchema.safeParse({ username: "admin", password: "secret" }).success).toBe(true);
  });
  it("rejects unknown PIN validation fields", () => {
    expect(validatePinSchema.safeParse({ userId: 7, pin: "4826", terminalId: 9 }).success).toBe(false);
  });
  it("rejects a PIN validation request without target user", () => {
    expect(validatePinSchema.safeParse({ pin: "4826" }).success).toBe(false);
  });
  it("requires manager ID and PIN together for a discount", () => {
    expect(applyOrderDiscountSchema.safeParse({ discountPercent: 2, managerPin: "4826" }).success).toBe(false);
    expect(applyOrderDiscountSchema.safeParse({ discountPercent: 2, managerUserId: 7, managerPin: "4826" }).success).toBe(true);
  });
  it("requires manager ID and PIN together for a void", () => {
    expect(voidOrderSchema.safeParse({ reason: "test", managerUserId: 7 }).success).toBe(false);
    expect(voidOrderSchema.safeParse({ reason: "test", managerUserId: 7, managerPin: "4826" }).success).toBe(true);
  });
  it("rejects body-controlled terminal identity", () => {
    expect(loginBodySchema.safeParse({ userId: 7, pin: "4826", terminalId: 1 }).success).toBe(false);
  });
});
