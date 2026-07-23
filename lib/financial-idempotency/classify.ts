import { ApiError } from "@/lib/api/client";
import type { ClassifyFinancialErrorResult, FinancialErrorClass } from "./types";

function readErrorCode(error: ApiError): string | undefined {
  if (typeof error.code === "string" && error.code.length > 0) {
    return error.code;
  }
  if (
    error.details &&
    typeof error.details === "object" &&
    "code" in error.details &&
    typeof (error.details as { code: unknown }).code === "string"
  ) {
    return (error.details as { code: string }).code;
  }
  return undefined;
}

function result(
  classification: FinancialErrorClass,
  message: string,
  extras: Partial<ClassifyFinancialErrorResult> = {},
): ClassifyFinancialErrorResult {
  const preservesAttempt =
    extras.preservesAttempt ??
    (classification === "network_uncertain" ||
      classification === "timeout_uncertain" ||
      classification === "abort_uncertain" ||
      classification === "server_uncertain" ||
      classification === "in_progress" ||
      classification === "unknown_uncertain" ||
      classification === "payload_mismatch" ||
      classification === "key_expired");
  const allowsSameKeyRetry =
    extras.allowsSameKeyRetry ??
    (classification === "network_uncertain" ||
      classification === "timeout_uncertain" ||
      classification === "abort_uncertain" ||
      classification === "server_uncertain" ||
      classification === "in_progress" ||
      classification === "unknown_uncertain");
  const requiresOrderRefresh =
    extras.requiresOrderRefresh ??
    (classification === "business_conflict" ||
      classification === "payload_mismatch" ||
      classification === "key_expired");

  return {
    classification,
    preservesAttempt,
    allowsSameKeyRetry,
    requiresOrderRefresh,
    message,
    ...extras,
  };
}

/**
 * Classify transport and financial idempotency failures for attempt lifecycle.
 */
export function classifyFinancialRequestError(
  error: unknown,
): ClassifyFinancialErrorResult {
  if (error instanceof DOMException && error.name === "AbortError") {
    return result("abort_uncertain", "Request was aborted before completion");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return result("abort_uncertain", "Request was aborted before completion");
  }
  if (error instanceof TypeError) {
    return result("network_uncertain", error.message || "Network request failed");
  }
  if (!(error instanceof ApiError)) {
    return result(
      "unknown_uncertain",
      error instanceof Error ? error.message : "Unknown financial request failure",
    );
  }

  const code = readErrorCode(error);
  const status = error.status;

  if (code === "IDEMPOTENCY_IN_PROGRESS") {
    return result("in_progress", error.message, { code, status });
  }
  if (code === "IDEMPOTENCY_PAYLOAD_MISMATCH") {
    return result("payload_mismatch", error.message, {
      code,
      status,
      allowsSameKeyRetry: false,
      preservesAttempt: true,
      requiresOrderRefresh: true,
    });
  }
  if (code === "IDEMPOTENCY_KEY_EXPIRED") {
    return result("key_expired", error.message, {
      code,
      status,
      allowsSameKeyRetry: false,
      preservesAttempt: true,
      requiresOrderRefresh: true,
    });
  }
  if (status === 409) {
    return result("business_conflict", error.message, {
      code,
      status,
      preservesAttempt: false,
      allowsSameKeyRetry: false,
      requiresOrderRefresh: true,
    });
  }
  if (status === 408 || status === 504) {
    return result("timeout_uncertain", error.message, { code, status });
  }
  if (status >= 500) {
    return result("server_uncertain", error.message, { code, status });
  }
  if (status >= 400 && status < 500) {
    return result("client_terminal", error.message, {
      code,
      status,
      preservesAttempt: false,
      allowsSameKeyRetry: false,
      requiresOrderRefresh: false,
    });
  }

  return result("unknown_uncertain", error.message, { code, status });
}
