import { describe, expect, it } from "vitest";
import {
  buildCheckoutBusinessPayload,
  buildPartialPaymentBusinessPayload,
  buildRefundBusinessPayload,
  buildReturnBusinessPayload,
  buildVoidBusinessPayload,
  financialOperationPath,
  isFrontendFinancialOperation,
  toRequestBody,
} from "@/lib/financial-idempotency/operations";
import { FRONTEND_FINANCIAL_OPERATIONS } from "@/lib/financial-idempotency/constants";

describe("financial operation registry", () => {
  it("registers exactly the five backend financial operations", () => {
    expect([...FRONTEND_FINANCIAL_OPERATIONS]).toEqual([
      "order.checkout",
      "order.partial-payment",
      "order.refund",
      "order.return",
      "order.void",
    ]);
  });

  it("type-guards known operations and rejects others", () => {
    expect(isFrontendFinancialOperation("order.checkout")).toBe(true);
    expect(isFrontendFinancialOperation("order.discount")).toBe(false);
    expect(isFrontendFinancialOperation(null)).toBe(false);
  });

  it("maps each operation to its API path", () => {
    expect(financialOperationPath("order.checkout", 1)).toBe(
      "/api/orders/1/checkout",
    );
    expect(financialOperationPath("order.partial-payment", 2)).toBe(
      "/api/orders/2/partial-payment",
    );
    expect(financialOperationPath("order.refund", 3)).toBe(
      "/api/orders/3/refund",
    );
    expect(financialOperationPath("order.return", 4)).toBe(
      "/api/orders/4/return",
    );
    expect(financialOperationPath("order.void", 5)).toBe("/api/orders/5/void");
  });

  it("builds checkout request bodies without credentials", () => {
    const payload = buildCheckoutBusinessPayload({
      orderId: 1,
      paymentMethodId: 2,
      tenderedAmount: 100n,
      terminalId: 3,
    });
    const body = toRequestBody("order.checkout", payload);
    expect(body).toMatchObject({
      paymentMethodId: 2,
      tenderedAmount: "100",
      terminalId: 3,
      discountPercent: 0,
      taxPercent: 0,
      redeemPoints: "0",
    });
    expect(body).not.toHaveProperty("managerApprovalToken");
    expect(body).not.toHaveProperty("orderId");
  });

  it("builds deferred operation bodies for executor readiness without UI", () => {
    expect(
      toRequestBody(
        "order.partial-payment",
        buildPartialPaymentBusinessPayload({
          orderId: 1,
          paymentMethodId: 1,
          amount: 50n,
        }),
      ),
    ).toEqual({
      paymentMethodId: 1,
      amount: "50",
      referenceNo: null,
    });

    expect(
      toRequestBody(
        "order.refund",
        buildRefundBusinessPayload({
          orderId: 1,
          reason: "r",
          paymentMethodId: 1,
          terminalId: 2,
        }),
      ),
    ).toMatchObject({ reason: "r", paymentMethodId: 1, terminalId: 2 });

    expect(
      toRequestBody(
        "order.return",
        buildReturnBusinessPayload({
          orderId: 1,
          refundAmount: 10n,
          items: [{ orderItemId: 9, returnQty: 1, reason: "x" }],
        }),
      ),
    ).toMatchObject({ refundAmount: "10" });

    expect(
      toRequestBody(
        "order.void",
        buildVoidBusinessPayload({ orderId: 1, reason: "mistake" }),
      ),
    ).toEqual({ reason: "mistake", reverseStock: false });
  });

  it("defaults void reverseStock to false", () => {
    expect(buildVoidBusinessPayload({ orderId: 1, reason: "x" }).reverseStock).toBe(
      false,
    );
  });
});
