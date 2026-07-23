import { apiFetch, ApiError } from "@/lib/api/client";
import { classifyFinancialRequestError } from "./classify";
import { fingerprintFinancialBusinessPayload } from "./fingerprint";
import {
  abandonFinancialAttempt,
  completeFinancialAttempt,
  markFinancialAttemptUncertain,
  prepareFinancialAttempt,
} from "./lifecycle";
import {
  financialOperationPath,
  toRequestBody,
} from "./operations";
import type {
  ClassifyFinancialErrorResult,
  FinancialAttemptRecord,
  FinancialBusinessPayloadByOperation,
  FinancialExecutionCredentials,
  FrontendFinancialOperation,
} from "./types";

const inFlight = new Map<string, Promise<ExecuteFinancialAttemptResult<unknown>>>();

function flightKey(
  operation: FrontendFinancialOperation,
  resourceId: number,
): string {
  return `${operation}:${resourceId}`;
}

export type ExecuteFinancialAttemptSuccess<T> = {
  ok: true;
  data: T;
  attempt: FinancialAttemptRecord;
  reusedKey: boolean;
};

export type ExecuteFinancialAttemptFailure = {
  ok: false;
  attempt?: FinancialAttemptRecord;
  reusedKey?: boolean;
  classification: ClassifyFinancialErrorResult;
  error?: unknown;
  reason?:
    | "fingerprint_mismatch"
    | "missing_secure_key"
    | "storage_unavailable_for_new_key"
    | "unsupported_operation"
    | "in_flight_deduped";
};

export type ExecuteFinancialAttemptResult<T> =
  | ExecuteFinancialAttemptSuccess<T>
  | ExecuteFinancialAttemptFailure;

export type ExecuteFinancialAttemptInput<O extends FrontendFinancialOperation> = {
  operation: O;
  resourceId: number;
  business: FinancialBusinessPayloadByOperation[O];
  credentials?: FinancialExecutionCredentials;
  signal?: AbortSignal;
};

/**
 * Narrow financial-only executor. Injects Idempotency-Key only on this request.
 * Credentials (e.g. managerApprovalToken) stay out of fingerprints and storage.
 * Not an `async function` so the in-flight lock is taken synchronously.
 */
export function executeFinancialAttempt<
  O extends FrontendFinancialOperation,
  T = unknown,
>(input: ExecuteFinancialAttemptInput<O>): Promise<ExecuteFinancialAttemptResult<T>> {
  // Lock synchronously before any await so double-clicks share one in-flight promise.
  const dedupeKey = flightKey(input.operation, input.resourceId);
  const existingFlight = inFlight.get(dedupeKey);
  if (existingFlight) {
    return existingFlight as Promise<ExecuteFinancialAttemptResult<T>>;
  }

  const run = (async (): Promise<ExecuteFinancialAttemptResult<T>> => {
    try {
      const fingerprint = await fingerprintFinancialBusinessPayload(
        input.operation,
        input.business,
      );
      return await runFinancialAttempt<O, T>(input, fingerprint);
    } finally {
      inFlight.delete(dedupeKey);
    }
  })();

  inFlight.set(
    dedupeKey,
    run as Promise<ExecuteFinancialAttemptResult<unknown>>,
  );
  return run;
}

async function runFinancialAttempt<
  O extends FrontendFinancialOperation,
  T,
>(
  input: ExecuteFinancialAttemptInput<O>,
  fingerprint: string,
): Promise<ExecuteFinancialAttemptResult<T>> {
  const prepared = prepareFinancialAttempt({
    operation: input.operation,
    resourceId: input.resourceId,
    fingerprint,
  });
  if (!prepared.ok) {
    return {
      ok: false,
      attempt: prepared.existing,
      classification: {
        classification: "client_terminal",
        preservesAttempt: true,
        allowsSameKeyRetry: false,
        requiresOrderRefresh: prepared.reason === "fingerprint_mismatch",
        message: prepared.message,
      },
      reason: prepared.reason,
    };
  }

  const body = toRequestBody(input.operation, input.business);
  if (
    input.operation === "order.void" &&
    input.credentials?.managerApprovalToken
  ) {
    body.managerApprovalToken = input.credentials.managerApprovalToken;
  }

  const path = financialOperationPath(input.operation, input.resourceId);

  try {
    const data = await apiFetch<T>(path, {
      method: "POST",
      headers: {
        "Idempotency-Key": prepared.attempt.key,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    completeFinancialAttempt(input.operation, input.resourceId);
    return {
      ok: true,
      data,
      attempt: prepared.attempt,
      reusedKey: prepared.reusedKey,
    };
  } catch (error) {
    const classification = classifyFinancialRequestError(error);
    let attempt = prepared.attempt;
    if (classification.preservesAttempt) {
      attempt = markFinancialAttemptUncertain(prepared.attempt);
    } else {
      completeFinancialAttempt(input.operation, input.resourceId);
    }
    return {
      ok: false,
      attempt,
      reusedKey: prepared.reusedKey,
      classification,
      error,
    };
  }
}

export function resetFinancialAttemptInFlightForTests(): void {
  inFlight.clear();
}

export { abandonFinancialAttempt, completeFinancialAttempt };

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
