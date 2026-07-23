import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abandonCheckoutAttempt,
  loadCheckoutRecoveryAttempt,
  submitCheckoutWithIdempotency,
} from "@/lib/financial-idempotency/checkout";
import { resetFinancialAttemptInFlightForTests } from "@/lib/financial-idempotency/executor";
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

describe("checkout financial idempotency integration", () => {
  useFinancialIdempotencyTestHarness();

  beforeEach(() => {
    apiFetch.mockReset();
    resetFinancialAttemptInFlightForTests();
  });

  const fields = {
    paymentMethodId: 1,
    tenderedAmount: 3000n,
    terminalId: 2,
    discountPercent: 0,
    taxPercent: 0,
  };

  it("sends Idempotency-Key on checkout submit", async () => {
    apiFetch.mockResolvedValue({
      id: 55,
      orderNumber: "A-1",
      status: "Closed",
      cashier: { id: 1 },
      orderItems: [{ id: 1 }],
      payments: [{ id: 1 }],
    });
    const result = await submitCheckoutWithIdempotency({
      orderId: 55,
      fields,
    });
    expect(result.ok).toBe(true);
    const headers = new Headers(
      (apiFetch.mock.calls[0] as [string, RequestInit])[1].headers,
    );
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/orders/55/checkout");
  });

  it("restores pending checkout attempt after refresh without auto-submit", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    await submitCheckoutWithIdempotency({ orderId: 55, fields });
    const recovered = loadCheckoutRecoveryAttempt();
    expect(recovered?.resourceId).toBe(55);
    expect(recovered?.state).toBe("uncertain");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("retries retained checkout with the same key", async () => {
    apiFetch
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        id: 55,
        orderNumber: "A-1",
        status: "Closed",
      });
    await submitCheckoutWithIdempotency({ orderId: 55, fields });
    const key = readFinancialAttempt("order.checkout", 55)?.key;
    const retry = await submitCheckoutWithIdempotency({ orderId: 55, fields });
    expect(retry.ok).toBe(true);
    const headers = new Headers(
      (apiFetch.mock.calls[1] as [string, RequestInit])[1].headers,
    );
    expect(headers.get("Idempotency-Key")).toBe(key);
  });

  it("supports explicit abandonment before a new attempt", async () => {
    apiFetch.mockRejectedValue(new TypeError("offline"));
    await submitCheckoutWithIdempotency({ orderId: 55, fields });
    abandonCheckoutAttempt(55);
    expect(loadCheckoutRecoveryAttempt()).toBeNull();
    apiFetch.mockResolvedValue({ id: 55, orderNumber: "A-2", status: "Closed" });
    const next = await submitCheckoutWithIdempotency({
      orderId: 55,
      fields: { ...fields, tenderedAmount: 4000n },
    });
    expect(next.ok).toBe(true);
    expect(next.ok && next.reusedKey).toBe(false);
  });

  it("deduplicates double submit for the same checkout attempt", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const a = submitCheckoutWithIdempotency({ orderId: 55, fields });
    const b = submitCheckoutWithIdempotency({ orderId: 55, fields });
    expect(a).toBe(b);
    await vi.waitFor(() => {
      expect(resolvers.length).toBe(1);
    });
    resolvers[0]!({ id: 55, orderNumber: "A-1", status: "Closed" });
    await Promise.all([a, b]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
