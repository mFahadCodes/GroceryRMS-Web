import { describe, expect, it } from "vitest";
import {
  buildCashDrawerEntryAuditMetadata,
  buildInventoryApplyAuditMetadata,
  buildManagerApprovalAuditMetadata,
  buildOrderCheckoutAuditMetadata,
  buildOrderDiscountAuditMetadata,
  buildOrderItemAddedAuditMetadata,
  buildOrderItemQuantityAuditMetadata,
  buildOrderItemVoidAuditMetadata,
  buildOrderMetadataUpdateAuditMetadata,
  buildOrderPartialPaymentAuditMetadata,
  buildOrderRefundAuditMetadata,
  buildOrderReturnAuditMetadata,
  buildOrderVoidAuditMetadata,
  buildPasswordChangedAuditMetadata,
  buildPinChangedAuditMetadata,
  buildRolePermissionsAuditMetadata,
  buildSessionForceLogoutAuditMetadata,
  buildSettingUpsertAuditMetadata,
  buildShiftAuditMetadata,
  buildUserAccountAuditMetadata,
  summarizeFreeTextReason,
} from "../../../lib/security/audit-metadata";

describe("audit event builders", () => {
  it("summarizes free-text reasons without keeping verbatim text", () => {
    expect(summarizeFreeTextReason("customer changed mind")).toEqual({
      reasonProvided: true,
      reasonLength: 21,
    });
    expect(summarizeFreeTextReason("   ")).toEqual({
      reasonProvided: false,
      reasonLength: 0,
    });
    expect(summarizeFreeTextReason(null)).toEqual({
      reasonProvided: false,
      reasonLength: 0,
    });
    expect(summarizeFreeTextReason(undefined)).toEqual({
      reasonProvided: false,
      reasonLength: 0,
    });
  });

  it("bounds extremely long free-text lengths", () => {
    const long = "x".repeat(12_000);
    expect(summarizeFreeTextReason(long)).toEqual({
      reasonProvided: true,
      reasonLength: 10_000,
    });
  });

  it("builds password and PIN metadata without secrets", () => {
    expect(buildPasswordChangedAuditMetadata()).toEqual({
      success: true,
      reauthenticationRequired: true,
    });
    expect(buildPinChangedAuditMetadata("administrator-changed")).toEqual({
      reason: "administrator-changed",
    });
    expect(buildPinChangedAuditMetadata("verified")).toEqual({
      reason: "verified",
    });
  });

  it("builds setting metadata without ever including the value", () => {
    const metadata = buildSettingUpsertAuditMetadata({
      settingKey: "ApiKey",
      dataType: "string",
      value: "super-secret-value-do-not-store",
    });
    expect(metadata).toEqual({
      settingKey: "ApiKey",
      dataType: "string",
      valuePresent: true,
    });
    expect(Object.keys(metadata)).not.toContain("value");
    expect(JSON.stringify(metadata)).not.toContain("super-secret");
  });

  it("marks empty setting values as not present", () => {
    expect(
      buildSettingUpsertAuditMetadata({
        settingKey: "Empty",
        dataType: "string",
        value: "",
      }).valuePresent,
    ).toBe(false);
    expect(
      buildSettingUpsertAuditMetadata({
        settingKey: "Null",
        dataType: "string",
        value: null,
      }).valuePresent,
    ).toBe(false);
  });

  it("builds checkout and partial payment metadata", () => {
    expect(
      buildOrderCheckoutAuditMetadata({
        terminalId: 3,
        paymentMethodIds: [1, 2],
        grandTotal: 12_500n,
      }),
    ).toEqual({
      terminalId: 3,
      paymentCount: 2,
      paymentMethodIds: [1, 2],
      grandTotal: "12500",
    });
    expect(
      buildOrderPartialPaymentAuditMetadata({
        paymentMethodId: 4,
        amount: 500n,
        fullyPaid: false,
      }),
    ).toEqual({
      paymentMethodId: 4,
      amount: "500",
      fullyPaid: false,
    });
  });

  it("builds refund and return metadata without free-text reasons", () => {
    const refund = buildOrderRefundAuditMetadata({
      amount: 2500n,
      paymentMethodId: 1,
      reason: "wrong item shipped",
      refundOrderId: 88,
    });
    expect(refund).toEqual({
      reasonProvided: true,
      reasonLength: 18,
      amount: "2500",
      paymentMethodId: 1,
      refundOrderId: 88,
    });
    expect(JSON.stringify(refund)).not.toContain("wrong item");
    expect(
      buildOrderReturnAuditMetadata({
        itemCount: 2,
        refundAmount: 900n,
        refundOrderId: 91,
      }),
    ).toEqual({
      itemCount: 2,
      refundAmount: "900",
      refundOrderId: 91,
    });
  });

  it("builds void and discount metadata with reason summaries only", () => {
    expect(
      buildOrderVoidAuditMetadata({
        reason: "damaged goods",
        approvedByUserId: 7,
        stockReversed: true,
      }),
    ).toEqual({
      reasonProvided: true,
      reasonLength: 13,
      approvedByUserId: 7,
      stockReversed: true,
    });
    expect(
      buildOrderDiscountAuditMetadata({
        discountAmount: 400n,
        discountPercent: 10,
        reason: null,
        approvedByUserId: null,
      }),
    ).toEqual({
      discountAmount: "400",
      discountPercent: 10,
      reasonProvided: false,
      reasonLength: 0,
      approvedByUserId: null,
    });
  });

  it("builds user account metadata with field names and credential flags", () => {
    expect(
      buildUserAccountAuditMetadata({
        username: "cashier",
        roleId: 2,
        fieldsChanged: ["username", "roleId", "password"],
        passwordChanged: true,
        pinChanged: false,
        isActive: true,
      }),
    ).toEqual({
      username: "cashier",
      roleId: 2,
      fieldsChanged: ["username", "roleId", "password"],
      passwordChanged: true,
      pinChanged: false,
      isActive: true,
    });
  });

  it("builds role permissions metadata without embedding secrets", () => {
    expect(
      buildRolePermissionsAuditMetadata({
        roleId: 2,
        permissions: [
          { permissionId: 1, accessLevel: 4 },
          { permissionId: 3, accessLevel: 1 },
        ],
      }),
    ).toEqual({
      roleId: 2,
      permissionCount: 2,
      permissions: [
        { permissionId: 1, accessLevel: 4 },
        { permissionId: 3, accessLevel: 1 },
      ],
    });
  });

  it("builds manager approval and force-logout metadata", () => {
    expect(
      buildManagerApprovalAuditMetadata({
        approverUserId: 7,
        action: "order.void",
        resourceType: "order",
        status: "issued",
      }),
    ).toEqual({
      approverUserId: 7,
      action: "order.void",
      resourceType: "order",
      status: "issued",
    });
    expect(
      buildSessionForceLogoutAuditMetadata({
        userId: 2,
        username: "requester",
      }),
    ).toEqual({ userId: 2, username: "requester" });
  });

  it("builds inventory apply metadata", () => {
    expect(buildInventoryApplyAuditMetadata({ itemCount: 12 })).toEqual({
      itemCount: 12,
    });
  });

  it("builds cash drawer and shift metadata without free-text notes", () => {
    expect(
      buildCashDrawerEntryAuditMetadata({
        type: "PayOut",
        amount: 1500n,
        description: "petty cash for stamps",
        orderId: 50,
      }),
    ).toEqual({
      type: "PayOut",
      amount: "1500",
      descriptionProvided: true,
      orderId: 50,
    });
    expect(
      buildShiftAuditMetadata({
        terminalId: 1,
        balance: 20_000n,
        notes: "closing early",
      }),
    ).toEqual({
      terminalId: 1,
      balance: "20000",
      notesProvided: true,
    });
    expect(
      JSON.stringify(
        buildCashDrawerEntryAuditMetadata({
          type: "PayIn",
          amount: 1n,
          description: "petty cash for stamps",
        }),
      ),
    ).not.toContain("petty cash");
  });

  it("builds order item and metadata update builders safely", () => {
    expect(
      buildOrderItemAddedAuditMetadata({
        productId: 9,
        variantId: null,
        quantity: 2,
        weightKg: "1.5",
        notes: "slice thin",
        scannedBarcode: "123",
      }),
    ).toEqual({
      productId: 9,
      variantId: null,
      quantity: 2,
      weightProvided: true,
      notesProvided: true,
      scannedBarcodeProvided: true,
    });
    expect(
      buildOrderItemQuantityAuditMetadata({
        orderItemId: 44,
        quantity: 3,
      }),
    ).toEqual({ orderItemId: 44, quantity: 3 });
    expect(
      buildOrderItemVoidAuditMetadata({
        orderItemId: 44,
        voidReason: "wrong sku",
      }),
    ).toEqual({
      reasonProvided: true,
      reasonLength: 9,
      orderItemId: 44,
    });
    expect(
      buildOrderMetadataUpdateAuditMetadata({
        notes: "leave at door",
        customerId: 5,
      }),
    ).toEqual({ notesProvided: true, customerId: 5 });
  });
});
