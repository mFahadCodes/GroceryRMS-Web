import { describe, expect, it } from "vitest";
import {
  buildOrderDiscountAuditMetadata,
  buildOrderRefundAuditMetadata,
  buildOrderVoidAuditMetadata,
  summarizeFreeTextReason,
} from "../../../lib/security/audit-metadata";

describe("audit free-text policy", () => {
  it("summarizeFreeTextReason records presence and bounded length only", () => {
    expect(summarizeFreeTextReason("damaged packaging")).toEqual({
      reasonProvided: true,
      reasonLength: 17,
    });
    expect(summarizeFreeTextReason("")).toEqual({
      reasonProvided: false,
      reasonLength: 0,
    });
    expect(summarizeFreeTextReason(" \t\n ")).toEqual({
      reasonProvided: false,
      reasonLength: 0,
    });
  });

  it("trims before measuring length", () => {
    expect(summarizeFreeTextReason("  abc  ")).toEqual({
      reasonProvided: true,
      reasonLength: 3,
    });
  });

  it("void builder never embeds reason text", () => {
    const reason = "customer complained about freshness and demanded a void";
    const metadata = buildOrderVoidAuditMetadata({
      reason,
      approvedByUserId: 7,
      stockReversed: false,
    });
    expect(metadata.reasonProvided).toBe(true);
    expect(metadata.reasonLength).toBe(reason.length);
    expect(Object.keys(metadata)).not.toContain("reason");
    expect(JSON.stringify(metadata)).not.toContain("complained");
    expect(JSON.stringify(metadata)).not.toContain(reason);
  });

  it("discount builder never embeds reason text", () => {
    const reason = "manager approved goodwill discount for loyalty";
    const metadata = buildOrderDiscountAuditMetadata({
      discountAmount: 100n,
      reason,
      approvedByUserId: 7,
    });
    expect(metadata).toMatchObject({
      reasonProvided: true,
      reasonLength: reason.length,
      approvedByUserId: 7,
      discountAmount: "100",
    });
    expect(Object.keys(metadata)).not.toContain("reason");
    expect(JSON.stringify(metadata)).not.toContain("goodwill");
  });

  it("refund builder never embeds reason text", () => {
    const reason = "duplicate charge on card ending 4242";
    const metadata = buildOrderRefundAuditMetadata({
      amount: 500n,
      paymentMethodId: 1,
      reason,
      refundOrderId: 77,
    });
    expect(metadata.reasonProvided).toBe(true);
    expect(metadata.reasonLength).toBe(reason.length);
    expect(Object.keys(metadata)).not.toContain("reason");
    expect(JSON.stringify(metadata)).not.toContain("4242");
    expect(JSON.stringify(metadata)).not.toContain("duplicate");
  });

  it("short numeric free text is still only summarized", () => {
    const reason = "4826";
    const voidMeta = buildOrderVoidAuditMetadata({
      reason,
      approvedByUserId: null,
      stockReversed: false,
    });
    const discountMeta = buildOrderDiscountAuditMetadata({
      reason,
      approvedByUserId: null,
    });
    const refundMeta = buildOrderRefundAuditMetadata({
      amount: 1n,
      paymentMethodId: 1,
      reason,
      refundOrderId: 1,
    });
    for (const metadata of [voidMeta, discountMeta, refundMeta]) {
      expect(metadata).toMatchObject({
        reasonProvided: true,
        reasonLength: 4,
      });
      expect(JSON.stringify(metadata)).not.toContain("4826");
      expect(Object.keys(metadata)).not.toContain("reason");
    }
  });

  it("does not redact globally when free text is absent", () => {
    const metadata = buildOrderDiscountAuditMetadata({
      discountAmount: 250n,
      discountPercent: 5,
      reason: null,
      approvedByUserId: 7,
    });
    expect(metadata).toEqual({
      discountAmount: "250",
      discountPercent: 5,
      reasonProvided: false,
      reasonLength: 0,
      approvedByUserId: 7,
    });
  });

  it("omitted reason is treated as not provided", () => {
    expect(summarizeFreeTextReason(undefined).reasonProvided).toBe(false);
    expect(
      buildOrderVoidAuditMetadata({
        reason: undefined,
        approvedByUserId: 1,
        stockReversed: true,
      }).reasonProvided,
    ).toBe(false);
  });
});
