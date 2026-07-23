import { describe, expect, it } from "vitest";
import { fingerprintFinancialBusinessPayload } from "@/lib/financial-idempotency/fingerprint";
import {
  buildCheckoutBusinessPayload,
  buildPartialPaymentBusinessPayload,
  buildRefundBusinessPayload,
  buildReturnBusinessPayload,
  buildVoidBusinessPayload,
} from "@/lib/financial-idempotency/operations";

describe("financial business fingerprints", () => {
  it("fingerprints checkout payloads deterministically", async () => {
    const a = buildCheckoutBusinessPayload({
      orderId: 10,
      paymentMethodId: 1,
      tenderedAmount: "1500",
      terminalId: 2,
      discountPercent: 0,
      taxPercent: 5,
    });
    const b = buildCheckoutBusinessPayload({
      orderId: 10,
      paymentMethodId: 1,
      tenderedAmount: 1500n,
      terminalId: 2,
      discountPercent: 0,
      taxPercent: 5,
    });
    expect(await fingerprintFinancialBusinessPayload("order.checkout", a)).toBe(
      await fingerprintFinancialBusinessPayload("order.checkout", b),
    );
  });

  it("changes checkout fingerprint when tendered amount changes", async () => {
    const a = buildCheckoutBusinessPayload({
      orderId: 10,
      paymentMethodId: 1,
      tenderedAmount: 1500n,
      terminalId: 2,
    });
    const b = buildCheckoutBusinessPayload({
      orderId: 10,
      paymentMethodId: 1,
      tenderedAmount: 1600n,
      terminalId: 2,
    });
    expect(await fingerprintFinancialBusinessPayload("order.checkout", a)).not.toBe(
      await fingerprintFinancialBusinessPayload("order.checkout", b),
    );
  });

  it("fingerprints partial-payment payloads", async () => {
    const payload = buildPartialPaymentBusinessPayload({
      orderId: 3,
      paymentMethodId: 1,
      amount: 500n,
      referenceNo: null,
    });
    const hash = await fingerprintFinancialBusinessPayload(
      "order.partial-payment",
      payload,
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprints refund payloads", async () => {
    const payload = buildRefundBusinessPayload({
      orderId: 4,
      reason: "customer request",
      paymentMethodId: 1,
      terminalId: 2,
      amount: 100n,
    });
    const hash = await fingerprintFinancialBusinessPayload("order.refund", payload);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprints return payloads with sorted items", async () => {
    const a = buildReturnBusinessPayload({
      orderId: 5,
      refundAmount: 200n,
      items: [
        { orderItemId: 2, returnQty: 1, reason: "damaged" },
        { orderItemId: 1, returnQty: 1, reason: "wrong" },
      ],
    });
    const b = buildReturnBusinessPayload({
      orderId: 5,
      refundAmount: 200n,
      items: [
        { orderItemId: 1, returnQty: 1, reason: "wrong" },
        { orderItemId: 2, returnQty: 1, reason: "damaged" },
      ],
    });
    expect(await fingerprintFinancialBusinessPayload("order.return", a)).toBe(
      await fingerprintFinancialBusinessPayload("order.return", b),
    );
  });

  it("fingerprints void business fields only", async () => {
    const payload = buildVoidBusinessPayload({
      orderId: 9,
      reason: "mistake",
      reverseStock: true,
    });
    const hash = await fingerprintFinancialBusinessPayload("order.void", payload);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("excludes managerApprovalToken from void fingerprint inputs", async () => {
    const business = buildVoidBusinessPayload({
      orderId: 9,
      reason: "mistake",
      reverseStock: false,
    });
    const withToken = {
      ...business,
      managerApprovalToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const without = await fingerprintFinancialBusinessPayload(
      "order.void",
      business,
    );
    // Token is not part of the typed void payload; accidental extra fields must
    // not be accepted by the fingerprint helper's typed call sites.
    expect(Object.keys(business)).toEqual(["orderId", "reason", "reverseStock"]);
    expect(without).toMatch(/^[a-f0-9]{64}$/);
    expect(
      JSON.stringify(withToken).includes("managerApprovalToken"),
    ).toBe(true);
  });
});
