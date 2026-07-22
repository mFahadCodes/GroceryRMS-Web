import { describe, expect, it } from "vitest";

/**
 * Refund/return routes do not require manager approval today.
 * This file locks that contract so approval replay rules remain N/A unless
 * a future phase adds an approval action.
 */
describe("refund/return manager approval contract", () => {
  it("manager approval action map does not include refund or return", async () => {
    const { MANAGER_APPROVAL_ACTIONS } = await import(
      "@/lib/security/manager-approval"
    );
    expect(MANAGER_APPROVAL_ACTIONS).not.toContain("order.refund");
    expect(MANAGER_APPROVAL_ACTIONS).not.toContain("order.return");
  });

  it("refund and return validators do not require managerApprovalToken", async () => {
    const { refundOrderSchema, returnOrderItemsSchema } = await import(
      "@/lib/validators/order.validators"
    );
    expect(refundOrderSchema.safeParse({
      reason: "x",
      paymentMethodId: 1,
      terminalId: 1,
    }).success).toBe(true);
    expect(
      returnOrderItemsSchema.safeParse({
        items: [{ orderItemId: 1, returnQty: 1, reason: "x" }],
        refundAmount: "100",
      }).success,
    ).toBe(true);
    const refundShape = refundOrderSchema.safeParse({
      reason: "x",
      paymentMethodId: 1,
      terminalId: 1,
      managerApprovalToken: "x".repeat(43),
    });
    // Extra keys are stripped by default zod object (not strict) — token is ignored.
    expect(refundShape.success).toBe(true);
  });
});
