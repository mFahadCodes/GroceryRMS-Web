import { describe, expect, it } from "vitest";
import {
  FINANCIAL_ATTEMPT_RETENTION_MS,
  FINANCIAL_ATTEMPT_STORAGE_VERSION,
} from "@/lib/financial-idempotency/constants";
import {
  clearFinancialAttempt,
  createAttemptRecord,
  findRetainedCheckoutAttempt,
  parseFinancialAttemptRecord,
  readFinancialAttempt,
  writeFinancialAttempt,
} from "@/lib/financial-idempotency/storage";
import { useFinancialIdempotencyTestHarness } from "./financial-idempotency-test-harness";

describe("financial attempt storage", () => {
  useFinancialIdempotencyTestHarness();

  it("round-trips a versioned attempt record", () => {
    const record = createAttemptRecord({
      operation: "order.checkout",
      resourceId: 42,
      key: "550e8400-e29b-41d4-a716-446655440000",
      fingerprint: "a".repeat(64),
      now: 1_000,
    });
    writeFinancialAttempt(record);
    expect(readFinancialAttempt("order.checkout", 42, 1_000)).toEqual(record);
  });

  it("rejects malformed records", () => {
    expect(parseFinancialAttemptRecord({ version: 999 })).toBeNull();
    expect(
      parseFinancialAttemptRecord({
        version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
        operation: "order.discount",
        resourceId: 1,
        key: "550e8400-e29b-41d4-a716-446655440000",
        fingerprint: "a".repeat(64),
        createdAt: 1,
        lastAttemptAt: 1,
        state: "pending",
        retryCount: 0,
      }),
    ).toBeNull();
  });

  it("rejects expired records beyond seven days", () => {
    const createdAt = 1_000;
    const record = {
      version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
      operation: "order.checkout" as const,
      resourceId: 7,
      key: "550e8400-e29b-41d4-a716-446655440000",
      fingerprint: "b".repeat(64),
      createdAt,
      lastAttemptAt: createdAt,
      state: "uncertain" as const,
      retryCount: 1,
    };
    expect(
      parseFinancialAttemptRecord(
        record,
        createdAt + FINANCIAL_ATTEMPT_RETENTION_MS + 1,
      ),
    ).toBeNull();
  });

  it("rejects records that embed manager credentials or full payloads", () => {
    expect(
      parseFinancialAttemptRecord({
        version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
        operation: "order.void",
        resourceId: 1,
        key: "550e8400-e29b-41d4-a716-446655440000",
        fingerprint: "c".repeat(64),
        createdAt: 1,
        lastAttemptAt: 1,
        state: "pending",
        retryCount: 0,
        managerApprovalToken: "secret",
      }),
    ).toBeNull();
    expect(
      parseFinancialAttemptRecord({
        version: FINANCIAL_ATTEMPT_STORAGE_VERSION,
        operation: "order.checkout",
        resourceId: 1,
        key: "550e8400-e29b-41d4-a716-446655440000",
        fingerprint: "c".repeat(64),
        createdAt: 1,
        lastAttemptAt: 1,
        state: "pending",
        retryCount: 0,
        payload: { tenderedAmount: "100" },
      }),
    ).toBeNull();
  });

  it("returns null safely when sessionStorage is unavailable (SSR)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).sessionStorage = undefined;
    expect(readFinancialAttempt("order.checkout", 1)).toBeNull();
    expect(() =>
      writeFinancialAttempt(
        createAttemptRecord({
          operation: "order.checkout",
          resourceId: 1,
          key: "550e8400-e29b-41d4-a716-446655440000",
          fingerprint: "d".repeat(64),
        }),
      ),
    ).not.toThrow();
  });

  it("finds retained checkout attempts for page-refresh recovery", () => {
    writeFinancialAttempt(
      createAttemptRecord({
        operation: "order.checkout",
        resourceId: 99,
        key: "550e8400-e29b-41d4-a716-446655440099",
        fingerprint: "e".repeat(64),
        state: "uncertain",
      }),
    );
    expect(findRetainedCheckoutAttempt()?.resourceId).toBe(99);
    clearFinancialAttempt("order.checkout", 99);
    expect(findRetainedCheckoutAttempt()).toBeNull();
  });

  it("rejects wrong-resource reads", () => {
    writeFinancialAttempt(
      createAttemptRecord({
        operation: "order.refund",
        resourceId: 5,
        key: "550e8400-e29b-41d4-a716-446655440005",
        fingerprint: "f".repeat(64),
      }),
    );
    expect(readFinancialAttempt("order.refund", 6)).toBeNull();
  });
});
