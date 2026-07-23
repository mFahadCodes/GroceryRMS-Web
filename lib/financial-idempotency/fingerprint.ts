import {
  canonicalizeFinancialPayload,
  sha256Hex,
  stableStringify,
} from "./canonicalize";
import { FINANCIAL_FINGERPRINT_VERSION } from "./constants";
import type {
  FinancialBusinessPayloadByOperation,
  FrontendFinancialOperation,
} from "./types";

/**
 * Deterministic SHA-256 fingerprint over mutation-relevant business fields only.
 * Excludes managerApprovalToken, idempotency key, auth, and UI-only fields.
 */
export async function fingerprintFinancialBusinessPayload<
  O extends FrontendFinancialOperation,
>(
  operation: O,
  payload: FinancialBusinessPayloadByOperation[O],
): Promise<string> {
  const envelope = {
    v: FINANCIAL_FINGERPRINT_VERSION,
    operation,
    resourceType: "orders",
    resourceId: (payload as { orderId: number }).orderId,
    payload: canonicalizeFinancialPayload(payload),
  };
  return sha256Hex(stableStringify(envelope));
}
