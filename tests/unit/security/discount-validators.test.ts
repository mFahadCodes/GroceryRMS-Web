import { describe, expect, it } from "vitest";
import {
  applyOrderDiscountBusinessSchema,
  applyOrderDiscountManagerApprovalTokenSchema,
  applyOrderDiscountSchema,
} from "@/lib/validators/order.validators";

const VALID_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("discount request validators", () => {
  it("accepts discountAmount-only business payloads", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: 500,
      reason: "courtesy",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.discountAmount).toBe(500n);
    }
  });

  it("accepts discountPercent-only business payloads", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountPercent: 10,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts zero discountAmount as an Open reset", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts string paisa discountAmount values", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: "1250",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.discountAmount).toBe(1250n);
    }
  });

  it("rejects business payloads missing both amount and percent", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      reason: "missing discount fields",
    });
    expect(parsed.success).toBe(false);
  });

  it("inherits existing paisaSchema acceptance of negative integers at the wire layer", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: -1,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects discountPercent above 100", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountPercent: 100.1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects discountPercent below 0", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountPercent: -0.01,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown business fields under strict mode", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: 100,
      managerApprovalToken: VALID_TOKEN,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts null reason on the business schema", () => {
    const parsed = applyOrderDiscountBusinessSchema.safeParse({
      discountAmount: 50,
      reason: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a 43-character manager approval token", () => {
    const parsed =
      applyOrderDiscountManagerApprovalTokenSchema.safeParse(VALID_TOKEN);
    expect(parsed.success).toBe(true);
  });

  it("rejects short manager approval tokens", () => {
    const parsed =
      applyOrderDiscountManagerApprovalTokenSchema.safeParse("too-short");
    expect(parsed.success).toBe(false);
  });

  it("rejects manager PIN shaped credentials on the token schema", () => {
    const parsed = applyOrderDiscountManagerApprovalTokenSchema.safeParse("9999");
    expect(parsed.success).toBe(false);
  });

  it("combined schema still requires the manager approval token", () => {
    const parsed = applyOrderDiscountSchema.safeParse({
      discountAmount: 100,
    });
    expect(parsed.success).toBe(false);
  });

  it("combined schema accepts amount plus token", () => {
    const parsed = applyOrderDiscountSchema.safeParse({
      discountAmount: 100,
      managerApprovalToken: VALID_TOKEN,
    });
    expect(parsed.success).toBe(true);
  });

  it("combined schema rejects unknown fields", () => {
    const parsed = applyOrderDiscountSchema.safeParse({
      discountAmount: 100,
      managerApprovalToken: VALID_TOKEN,
      managerPin: "9999",
    });
    expect(parsed.success).toBe(false);
  });
});
