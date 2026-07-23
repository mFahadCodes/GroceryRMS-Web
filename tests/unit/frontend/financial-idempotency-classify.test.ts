import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { classifyFinancialRequestError } from "@/lib/financial-idempotency/classify";

describe("classifyFinancialRequestError", () => {
  it("treats network TypeError as uncertain and retryable", () => {
    const result = classifyFinancialRequestError(new TypeError("Failed to fetch"));
    expect(result.classification).toBe("network_uncertain");
    expect(result.preservesAttempt).toBe(true);
    expect(result.allowsSameKeyRetry).toBe(true);
  });

  it("treats abort as uncertain", () => {
    const result = classifyFinancialRequestError(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(result.classification).toBe("abort_uncertain");
    expect(result.preservesAttempt).toBe(true);
  });

  it("treats unknown 5xx as uncertain", () => {
    const result = classifyFinancialRequestError(
      new ApiError("boom", 500, undefined, "INTERNAL"),
    );
    expect(result.classification).toBe("server_uncertain");
    expect(result.preservesAttempt).toBe(true);
    expect(result.allowsSameKeyRetry).toBe(true);
  });

  it("classifies IDEMPOTENCY_IN_PROGRESS for same-key retry", () => {
    const result = classifyFinancialRequestError(
      new ApiError("in progress", 409, undefined, "IDEMPOTENCY_IN_PROGRESS"),
    );
    expect(result.classification).toBe("in_progress");
    expect(result.allowsSameKeyRetry).toBe(true);
    expect(result.preservesAttempt).toBe(true);
  });

  it("classifies payload mismatch as non-retryable without new key minting", () => {
    const result = classifyFinancialRequestError(
      new ApiError("mismatch", 409, undefined, "IDEMPOTENCY_PAYLOAD_MISMATCH"),
    );
    expect(result.classification).toBe("payload_mismatch");
    expect(result.allowsSameKeyRetry).toBe(false);
    expect(result.requiresOrderRefresh).toBe(true);
    expect(result.preservesAttempt).toBe(true);
  });

  it("classifies key expiry for reconciliation", () => {
    const result = classifyFinancialRequestError(
      new ApiError("expired", 409, undefined, "IDEMPOTENCY_KEY_EXPIRED"),
    );
    expect(result.classification).toBe("key_expired");
    expect(result.requiresOrderRefresh).toBe(true);
    expect(result.allowsSameKeyRetry).toBe(false);
  });

  it("classifies other 409 as business conflict requiring order refresh", () => {
    const result = classifyFinancialRequestError(
      new ApiError("order closed", 409, undefined, "ORDER_NOT_OPEN"),
    );
    expect(result.classification).toBe("business_conflict");
    expect(result.requiresOrderRefresh).toBe(true);
    expect(result.preservesAttempt).toBe(false);
  });

  it("classifies ordinary 4xx as terminal", () => {
    const result = classifyFinancialRequestError(
      new ApiError("bad", 400, undefined, "VALIDATION_ERROR"),
    );
    expect(result.classification).toBe("client_terminal");
    expect(result.preservesAttempt).toBe(false);
    expect(result.allowsSameKeyRetry).toBe(false);
  });

  it("treats timeouts as uncertain", () => {
    const result = classifyFinancialRequestError(
      new ApiError("timeout", 504, undefined, "GATEWAY_TIMEOUT"),
    );
    expect(result.classification).toBe("timeout_uncertain");
    expect(result.preservesAttempt).toBe(true);
  });
});
