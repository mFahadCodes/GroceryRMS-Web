import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  executeFinancialAttempt,
  resetFinancialAttemptInFlightForTests,
} from "@/lib/financial-idempotency/executor";
import { buildCheckoutBusinessPayload } from "@/lib/financial-idempotency/operations";
import { buildVoidBusinessPayload } from "@/lib/financial-idempotency/operations";
import { readFinancialAttempt } from "@/lib/financial-idempotency/storage";
import { useFinancialIdempotencyTestHarness } from "./financial-idempotency-test-harness";

const apiFetch = vi.fn();

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>(
    "@/lib/api/client",
  );
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
  };
});

describe("executeFinancialAttempt", () => {
  useFinancialIdempotencyTestHarness();

  beforeEach(() => {
    apiFetch.mockReset();
    resetFinancialAttemptInFlightForTests();
  });

  const checkoutBusiness = buildCheckoutBusinessPayload({
    orderId: 21,
    paymentMethodId: 1,
    tenderedAmount: 2500n,
    terminalId: 3,
    discountPercent: 0,
    taxPercent: 0,
  });

  it("injects Idempotency-Key only into the protected request", async () => {
    apiFetch.mockResolvedValue({
      id: 21,
      orderNumber: "ORD-1",
      status: "Closed",
    });
    const result = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(result.ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toMatch(
      /^[A-Za-z0-9._:-]{16,128}$/,
    );
    expect(readFinancialAttempt("order.checkout", 21)).toBeNull();
  });

  it("reuses the same key on network uncertainty retry", async () => {
    apiFetch
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce({ id: 21, orderNumber: "ORD-1", status: "Closed" });

    const first = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.classification.preservesAttempt).toBe(true);
    const retained = readFinancialAttempt("order.checkout", 21);
    expect(retained?.state).toBe("uncertain");
    const key = retained?.key;

    const second = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(second.ok).toBe(true);
    const [, init] = apiFetch.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(key);
  });

  it("deduplicates simultaneous submissions to one request", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const p1 = executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    const p2 = executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(p1).toBe(p2);
    // Allow fingerprint digest microtasks to reach apiFetch.
    await vi.waitFor(() => {
      expect(resolvers.length).toBe(1);
    });
    resolvers[0]!({ id: 21, orderNumber: "ORD-1", status: "Closed" });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.ok && b.ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves attempt on unknown 5xx", async () => {
    apiFetch.mockRejectedValue(new ApiError("nope", 503, undefined, "UNAVAILABLE"));
    const result = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(result.ok).toBe(false);
    expect(readFinancialAttempt("order.checkout", 21)?.state).toBe("uncertain");
  });

  it("preserves attempt on IDEMPOTENCY_IN_PROGRESS", async () => {
    apiFetch.mockRejectedValue(
      new ApiError("busy", 409, undefined, "IDEMPOTENCY_IN_PROGRESS"),
    );
    const result = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classification.classification).toBe("in_progress");
    expect(readFinancialAttempt("order.checkout", 21)).not.toBeNull();
  });

  it("clears attempt on matching success (including replay path)", async () => {
    apiFetch.mockResolvedValue({ id: 21, orderNumber: "ORD-1", status: "Closed" });
    await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(readFinancialAttempt("order.checkout", 21)).toBeNull();
  });

  it("marks business conflict for order refresh and clears attempt", async () => {
    apiFetch.mockRejectedValue(
      new ApiError("closed", 409, undefined, "ORDER_ALREADY_CLOSED"),
    );
    const result = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classification.requiresOrderRefresh).toBe(true);
    expect(readFinancialAttempt("order.checkout", 21)).toBeNull();
  });

  it("keeps mismatch retained without minting a replacement key", async () => {
    apiFetch.mockRejectedValue(
      new ApiError("mismatch", 409, undefined, "IDEMPOTENCY_PAYLOAD_MISMATCH"),
    );
    const result = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    expect(result.ok).toBe(false);
    const retained = readFinancialAttempt("order.checkout", 21);
    expect(retained).not.toBeNull();
    expect(result.ok === false && result.attempt?.key).toBe(retained?.key);
  });

  it("supports all five registered operations via path mapping", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    const ops = [
      ["order.checkout", checkoutBusiness, "/api/orders/21/checkout"],
      [
        "order.partial-payment",
        {
          orderId: 21,
          paymentMethodId: 1,
          amount: 100n,
          referenceNo: null,
        },
        "/api/orders/21/partial-payment",
      ],
      [
        "order.refund",
        {
          orderId: 21,
          reason: "r",
          amount: 50n,
          paymentMethodId: 1,
          terminalId: 3,
          referenceNo: null,
        },
        "/api/orders/21/refund",
      ],
      [
        "order.return",
        {
          orderId: 21,
          items: [{ orderItemId: 1, returnQty: 1, reason: "r" }],
          refundAmount: 50n,
        },
        "/api/orders/21/return",
      ],
      [
        "order.void",
        buildVoidBusinessPayload({ orderId: 21, reason: "mistake" }),
        "/api/orders/21/void",
      ],
    ] as const;

    for (const [operation, business, path] of ops) {
      apiFetch.mockClear();
      resetFinancialAttemptInFlightForTests();
      await executeFinancialAttempt({
        operation,
        resourceId: 21,
        business,
        credentials:
          operation === "order.void"
            ? {
                managerApprovalToken:
                  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
              }
            : undefined,
      } as never);
      expect(apiFetch.mock.calls[0]?.[0]).toBe(path);
    }
  });

  it("sends void approval token in body but does not persist it", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    await executeFinancialAttempt({
      operation: "order.void",
      resourceId: 44,
      business: buildVoidBusinessPayload({ orderId: 44, reason: "err" }),
      credentials: { managerApprovalToken: token },
    });
    const body = JSON.parse(
      String((apiFetch.mock.calls[0] as [string, RequestInit])[1].body),
    );
    expect(body.managerApprovalToken).toBe(token);
    expect(body.reason).toBe("err");
    const stored = sessionStorage.getItem(
      "groceryrms.financial-attempt.v1:order.void:44",
    );
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(token);
    expect(stored).not.toContain("managerApprovalToken");
  });

  it("blocks changed payload reuse while an attempt is retained", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: checkoutBusiness,
    });
    const changed = buildCheckoutBusinessPayload({
      ...checkoutBusiness,
      tenderedAmount: 9999n,
    });
    const blocked = await executeFinancialAttempt({
      operation: "order.checkout",
      resourceId: 21,
      business: changed,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe("fingerprint_mismatch");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
