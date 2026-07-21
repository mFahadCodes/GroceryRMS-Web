import { describe, expect, it } from "vitest";
import {
  applyOrderDiscountSchema,
  modifyOrderSchema,
  ORDER_META_NOTES_MAX_LENGTH,
  updateOrderMetaSchema,
  voidOrderSchema,
} from "../../../lib/validators/order.validators";

/**
 * SEC-04A: the generic order update validator is a strict allowlist. Every
 * protected order field must be rejected as an unknown key so the generic
 * route can never carry financial, state, payment, item, ownership, or
 * manager-approval data.
 */

const PROTECTED_META_FIELDS: Record<string, unknown> = {
  discountPercent: 10,
  discountAmount: 500,
  discount: 500,
  adjustment: 100,
  taxPercent: 5,
  tax: 100,
  taxAmount: 100,
  subtotal: 1000,
  subTotal: 1000,
  total: 1000,
  grandTotal: 1000,
  paidAmount: 1000,
  balance: 0,
  status: "Void",
  paymentStatus: "Paid",
  orderState: "Closed",
  voided: true,
  cancelled: true,
  refunded: true,
  returned: true,
  checkout: true,
  hold: true,
  recall: true,
  dispatch: true,
  delivered: true,
  deliveredAt: "2026-07-21T00:00:00.000Z",
  deliverySlot: "2026-07-21T00:00:00.000Z",
  managerPin: "4826",
  managerUserId: 7,
  managerApprovalToken: "A".repeat(43),
  approvedByUserId: 7,
  authVersion: 99,
  userId: 7,
  cashierId: 7,
  shiftId: 3,
  terminalId: 2,
  driverId: 4,
  taxRateId: 1,
  originalOrderId: 12,
  invoiceNumber: "INV-x",
  orderNumber: "ORD-x",
  orderType: "Refund",
  isActive: false,
  isSynced: true,
  voidReason: "because",
  serviceCharge: 100,
  items: [{ productId: 1, quantity: 1 }],
  payments: [{ paymentMethodId: 1, amount: 100 }],
  stock: [{ productId: 1, quantity: -1 }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("generic order update metadata allowlist", () => {
  it.each(Object.entries(PROTECTED_META_FIELDS))(
    "rejects protected or unknown field %s in updateMeta",
    (field, value) => {
      const result = modifyOrderSchema.safeParse({
        action: "updateMeta",
        notes: "plain note",
        [field]: value,
      });
      expect(result.success).toBe(false);
    },
  );

  it("accepts a plain note", () => {
    const result = modifyOrderSchema.safeParse({
      action: "updateMeta",
      notes: "Deliver to the back door",
    });
    expect(result.success).toBe(true);
  });

  it("accepts clearing the note with null", () => {
    const result = modifyOrderSchema.safeParse({
      action: "updateMeta",
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a customer assignment", () => {
    const result = modifyOrderSchema.safeParse({
      action: "updateMeta",
      customerId: 9,
    });
    expect(result.success).toBe(true);
  });

  it("accepts detaching the customer with null", () => {
    const result = modifyOrderSchema.safeParse({
      action: "updateMeta",
      customerId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty metadata update", () => {
    const result = modifyOrderSchema.safeParse({ action: "updateMeta" });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive and non-integer customer ids", () => {
    for (const customerId of [0, -1, 1.5, "9", true]) {
      expect(
        modifyOrderSchema.safeParse({ action: "updateMeta", customerId })
          .success,
      ).toBe(false);
    }
  });

  it("rejects non-string note values", () => {
    for (const notes of [42, true, { cmd: "void" }, ["hold"]]) {
      expect(
        modifyOrderSchema.safeParse({ action: "updateMeta", notes }).success,
      ).toBe(false);
    }
  });

  it("enforces the explicit maximum note length", () => {
    expect(
      updateOrderMetaSchema.safeParse({
        action: "updateMeta",
        notes: "x".repeat(ORDER_META_NOTES_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      updateOrderMetaSchema.safeParse({
        action: "updateMeta",
        notes: "x".repeat(ORDER_META_NOTES_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("preserves note text verbatim without trimming or normalization", () => {
    const notes = "  Hold the ONIONS — void: nothing  ";
    const result = updateOrderMetaSchema.safeParse({
      action: "updateMeta",
      notes,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe(notes);
      expect(result.data).toEqual({ action: "updateMeta", notes });
    }
  });

  it("parses former command strings as plain text fields only", () => {
    for (const notes of ["hold", "recall", "void: mistake", "VOID: x"]) {
      const result = updateOrderMetaSchema.safeParse({
        action: "updateMeta",
        notes,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data).sort()).toEqual(["action", "notes"]);
        expect(result.data.notes).toBe(notes);
      }
    }
  });
});

describe("generic order update action strictness", () => {
  it("rejects unknown actions", () => {
    for (const action of [
      "void",
      "cancel",
      "discount",
      "checkout",
      "hold",
      "recall",
      "dispatch",
      "delivered",
      "refund",
      "return",
      "payment",
    ]) {
      expect(modifyOrderSchema.safeParse({ action }).success).toBe(false);
    }
  });

  it("rejects non-object and empty bodies", () => {
    for (const body of [null, undefined, "updateMeta", 42, [], {}]) {
      expect(modifyOrderSchema.safeParse(body).success).toBe(false);
    }
  });

  it("rejects unknown fields on addItem", () => {
    expect(
      modifyOrderSchema.safeParse({
        action: "addItem",
        productId: 1,
        quantity: 1,
        discountPercent: 50,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields on updateItem", () => {
    expect(
      modifyOrderSchema.safeParse({
        action: "updateItem",
        orderItemId: 1,
        quantity: 2,
        unitPrice: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields on removeItem", () => {
    expect(
      modifyOrderSchema.safeParse({
        action: "removeItem",
        orderItemId: 1,
        status: "Void",
      }).success,
    ).toBe(false);
  });

  it("still accepts the existing item action contracts", () => {
    expect(
      modifyOrderSchema.safeParse({
        action: "addItem",
        productId: 3,
        variantId: null,
        quantity: 2,
        scannedBarcode: "123",
      }).success,
    ).toBe(true);
    expect(
      modifyOrderSchema.safeParse({
        action: "updateItem",
        orderItemId: 5,
        quantity: 0,
      }).success,
    ).toBe(true);
    expect(
      modifyOrderSchema.safeParse({
        action: "removeItem",
        orderItemId: 5,
        voidReason: "damaged",
      }).success,
    ).toBe(true);
  });
});

describe("dedicated privileged validators remain authoritative", () => {
  it("discount route still requires a manager approval token", () => {
    expect(
      applyOrderDiscountSchema.safeParse({ discountPercent: 10 }).success,
    ).toBe(false);
    expect(
      applyOrderDiscountSchema.safeParse({
        discountPercent: 10,
        managerApprovalToken: "A".repeat(43),
      }).success,
    ).toBe(true);
  });

  it("void route still requires a manager approval token", () => {
    expect(voidOrderSchema.safeParse({ reason: "damaged" }).success).toBe(
      false,
    );
    expect(
      voidOrderSchema.safeParse({
        reason: "damaged",
        managerApprovalToken: "A".repeat(43),
      }).success,
    ).toBe(true);
  });
});
