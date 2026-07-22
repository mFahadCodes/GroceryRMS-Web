import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  addItemToOrder: vi.fn(),
  calculateTotals: vi.fn(),
  getOrderById: vi.fn(),
  removeOrderItem: vi.fn(),
  updateItemQuantity: vi.fn(),
  updateOrderMetadata: vi.fn(),
  auditFromRequest: vi.fn(),
}));

vi.mock("@/lib/api/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit", () => ({ auditFromRequest: mocks.auditFromRequest }));
vi.mock("@/lib/services/order-service", () => ({
  addItemToOrder: mocks.addItemToOrder,
  calculateTotals: mocks.calculateTotals,
  getOrderById: mocks.getOrderById,
  removeOrderItem: mocks.removeOrderItem,
  updateItemQuantity: mocks.updateItemQuantity,
  updateOrderMetadata: mocks.updateOrderMetadata,
}));

import { PUT } from "../../../app/api/orders/[id]/route";
import { fail } from "../../../lib/api-response";

const OPEN_ORDER = {
  id: 50,
  status: "Open",
  notes: null,
  subTotal: 10_000n,
  grandTotal: 10_000n,
};

function levelOneSession() {
  return {
    session: {
      user: {
        id: 2,
        permissions: ["Create & process orders:1"],
      },
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/orders/50", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "50" }) };

function expectNoMutationAttempt() {
  expect(mocks.updateOrderMetadata).not.toHaveBeenCalled();
  expect(mocks.addItemToOrder).not.toHaveBeenCalled();
  expect(mocks.updateItemQuantity).not.toHaveBeenCalled();
  expect(mocks.removeOrderItem).not.toHaveBeenCalled();
  expect(mocks.auditFromRequest).not.toHaveBeenCalled();
}

describe("generic order update route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(levelOneSession());
    mocks.getOrderById.mockResolvedValue({ ...OPEN_ORDER });
    mocks.updateOrderMetadata.mockResolvedValue({ ...OPEN_ORDER });
  });

  it("requires the existing base permission before doing anything", async () => {
    mocks.requirePermission.mockResolvedValue({
      error: fail("Forbidden", "FORBIDDEN", 403),
    });
    const response = await PUT(
      request({ action: "updateMeta", notes: "hi" }),
      context,
    );
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      "Create & process orders",
      1,
    );
    expect(mocks.getOrderById).not.toHaveBeenCalled();
    expectNoMutationAttempt();
  });

  it("rejects non-open orders before parsing intent", async () => {
    mocks.getOrderById.mockResolvedValue({ ...OPEN_ORDER, status: "Closed" });
    const response = await PUT(
      request({ action: "updateMeta", notes: "hi" }),
      context,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "ORDER_NOT_OPEN" });
    expectNoMutationAttempt();
  });

  it("returns 404 for missing orders", async () => {
    mocks.getOrderById.mockResolvedValue(null);
    const response = await PUT(
      request({ action: "updateMeta", notes: "hi" }),
      context,
    );
    expect(response.status).toBe(404);
    expectNoMutationAttempt();
  });

  it("performs an approved safe metadata update for a level-1 user", async () => {
    const response = await PUT(
      request({ action: "updateMeta", notes: "Deliver later", customerId: 9 }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.updateOrderMetadata).toHaveBeenCalledExactlyOnceWith(50, {
      notes: "Deliver later",
      customerId: 9,
    });
    expect(mocks.auditFromRequest).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        userId: 2,
        action: "UPDATE_ORDER_META",
        recordId: 50,
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({ success: true });
    expect(body.data).toBeTruthy();
  });

  it("rejects an empty metadata payload with a stable validation error", async () => {
    const response = await PUT(request({ action: "updateMeta" }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expectNoMutationAttempt();
  });

  it("rejects an empty body and malformed JSON", async () => {
    for (const raw of ["", "{", "null", "[]"]) {
      const response = await PUT(request(raw), context);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expectNoMutationAttempt();
  });

  it("rejects oversized request bodies before validation", async () => {
    const response = await PUT(
      request({
        action: "updateMeta",
        notes: "x".repeat(32 * 1024),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expectNoMutationAttempt();
  });

  it("rejects oversized declared content-length without reading the body", async () => {
    const response = await PUT(
      request(
        { action: "updateMeta", notes: "small" },
        { "content-length": String(64 * 1024) },
      ),
      context,
    );
    expect(response.status).toBe(400);
    expectNoMutationAttempt();
  });

  it.each([
    ["discountPercent", { discountPercent: 50 }],
    ["discountAmount", { discountAmount: 5000 }],
    ["adjustment", { adjustment: -5000 }],
    ["taxPercent", { taxPercent: 0 }],
    ["status", { status: "Void" }],
    ["paymentStatus", { paymentStatus: "Paid" }],
    ["checkout flag", { checkout: true }],
    ["hold flag", { hold: true }],
    ["dispatch flag", { dispatch: true }],
    ["delivered flag", { delivered: true }],
    ["refund flag", { refunded: true }],
    ["return flag", { returned: true }],
    ["subtotal", { subTotal: 1 }],
    ["total", { grandTotal: 1 }],
    ["balance", { balance: 0 }],
    ["paidAmount", { paidAmount: 10_000 }],
    ["items", { items: [{ productId: 1, quantity: 99 }] }],
    ["payments", { payments: [{ paymentMethodId: 1, amount: 10_000 }] }],
    ["stock", { stock: [{ productId: 1, quantity: -5 }] }],
    ["managerPin", { managerPin: "4826" }],
    ["managerUserId", { managerUserId: 7 }],
    ["managerApprovalToken", { managerApprovalToken: "A".repeat(43) }],
    ["ownership", { cashierId: 7 }],
    ["session binding", { shiftId: 99, terminalId: 99 }],
  ])(
    "rejects privileged payload (%s) without invoking any service",
    async (_label, extra) => {
      const response = await PUT(
        request({ action: "updateMeta", notes: "n", ...extra }),
        context,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expectNoMutationAttempt();
    },
  );

  it("treats a former command note as plain metadata text", async () => {
    const response = await PUT(
      request({ action: "updateMeta", notes: "void: broken screen" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.updateOrderMetadata).toHaveBeenCalledExactlyOnceWith(50, {
      notes: "void: broken screen",
      customerId: undefined,
    });
  });

  it("maps service failures to the existing error envelope", async () => {
    mocks.updateOrderMetadata.mockRejectedValue(new Error("boom"));
    const response = await PUT(
      request({ action: "updateMeta", notes: "hi" }),
      context,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "MODIFY_ORDER_FAILED",
    });
    expect(mocks.auditFromRequest).not.toHaveBeenCalled();
  });

  it("preserves the existing item action wiring", async () => {
    mocks.addItemToOrder.mockResolvedValue({});
    mocks.calculateTotals.mockResolvedValue({ ...OPEN_ORDER });
    const response = await PUT(
      request({ action: "addItem", productId: 3, quantity: 2 }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.addItemToOrder).toHaveBeenCalledOnce();
    expect(mocks.calculateTotals).toHaveBeenCalledExactlyOnceWith(50);
    expect(mocks.updateOrderMetadata).not.toHaveBeenCalled();
  });
});
