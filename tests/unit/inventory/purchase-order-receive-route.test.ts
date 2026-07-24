import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "../../../lib/api/service-error";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  receivePurchaseOrder: vi.fn(),
}));

vi.mock("@/lib/api/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/services/inventory-service", () => ({
  receivePurchaseOrder: mocks.receivePurchaseOrder,
}));

import { POST } from "../../../app/api/inventory/purchase-orders/[id]/receive/route";

const auth = {
  error: null,
  session: {
    user: {
      id: 42,
      permissions: ["Manage inventory"],
    },
  },
};

function request(body: unknown, headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/inventory/purchase-orders/10/receive", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const context = (id = "10") => ({ params: Promise.resolve({ id }) });

describe("purchase-order receive route", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset();
    mocks.receivePurchaseOrder.mockReset();
    mocks.requirePermission.mockResolvedValue(auth);
    mocks.receivePurchaseOrder.mockResolvedValue({
      id: 10,
      status: "Received",
      totalAmount: 1000n,
      items: [],
    });
  });

  it("preserves Manage inventory authorization at access level 1", async () => {
    await POST(request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }), context());
    expect(mocks.requirePermission).toHaveBeenCalledWith("Manage inventory", 1);
  });

  it("returns the authorization response without calling the service", async () => {
    const denied = new Response("denied", { status: 403 });
    mocks.requirePermission.mockResolvedValue({ error: denied });
    const response = await POST(
      request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }),
      context(),
    );
    expect(response).toBe(denied);
    expect(mocks.receivePurchaseOrder).not.toHaveBeenCalled();
  });

  it("preserves INVALID_ID for a non-numeric route id", async () => {
    const response = await POST(
      request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }),
      context("not-an-id"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ID" });
  });

  it("preserves VALIDATION_ERROR for an empty item list", async () => {
    const response = await POST(request({ items: [] }), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps the existing request fields into the service DTO", async () => {
    await POST(
      request(
        { items: [{ purchaseOrderItemId: 9, receivedQty: "2.5" }] },
        { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      ),
      context("17"),
    );
    expect(mocks.receivePurchaseOrder).toHaveBeenCalledWith(
      17,
      [{ itemId: 9, quantityReceived: "2.5" }],
      42,
      "203.0.113.7",
    );
  });

  it("returns the existing success envelope", async () => {
    const response = await POST(
      request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }),
      context(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: 10, status: "Received", totalAmount: "1000" },
    });
  });

  it("maps service conflicts to their safe 409 contract", async () => {
    mocks.receivePurchaseOrder.mockRejectedValue(
      new ServiceError("Purchase order is not receivable", "PO_NOT_RECEIVABLE", 409),
    );
    const response = await POST(
      request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }),
      context(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PO_NOT_RECEIVABLE",
      error: "Purchase order is not receivable",
    });
  });

  it("does not expose unknown database or transaction errors", async () => {
    mocks.receivePurchaseOrder.mockRejectedValue(
      new Error("raw database transaction detail"),
    );
    const response = await POST(
      request({ items: [{ purchaseOrderItemId: 1, receivedQty: 2 }] }),
      context(),
    );
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toMatchObject({
      code: "RECEIVE_PURCHASE_ORDER_FAILED",
      error: "Failed to receive purchase order",
    });
    expect(JSON.stringify(payload)).not.toContain("raw database");
  });
});
