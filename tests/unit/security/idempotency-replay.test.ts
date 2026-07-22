import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
} from "./idempotency-test-database";

describe("executeFinancialIdempotent replay", () => {
  const database = createIdempotencyTestDatabase("p0a-replay");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  function runOnce(overrides: {
    rawKey?: string;
    actorUserId?: number;
    resourceId?: number;
    operation?: "order.checkout" | "order.partial-payment";
    authoritativeTerminalId?: number | null;
    payload?: unknown;
    now?: Date;
    execute: () => void;
  }) {
    return executeFinancialIdempotent({
      rawKey: overrides.rawKey ?? IDEMPOTENCY_TEST_KEY,
      operation: overrides.operation ?? "order.checkout",
      resourceType: "orders",
      resourceId: overrides.resourceId ?? 500,
      actorUserId: overrides.actorUserId ?? 2,
      authoritativeTerminalId:
        overrides.authoritativeTerminalId === undefined ? 1 : overrides.authoritativeTerminalId,
      requestPayload: overrides.payload ?? { amount: 1_000n },
      now: overrides.now,
      client: database.client,
      execute: async (tx) => {
        overrides.execute();
        const method = await tx.paymentMethod.create({
          data: { name: `Replay-${Date.now()}-${Math.random()}` },
        });
        return { status: 200, body: { paymentMethodId: method.id } };
      },
    });
  }

  it("succeeds on the first call and does not report a replay", async () => {
    let calls = 0;
    const result = await runOnce({ execute: () => calls++ });
    expect(result.replayed).toBe(false);
    expect(result.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("replays the exact same response on a second call with the same key and payload", async () => {
    let calls = 0;
    const first = await runOnce({ execute: () => calls++ });
    const second = await runOnce({ execute: () => calls++ });

    expect(second.replayed).toBe(true);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(calls).toBe(1);
  });

  it("does not invoke the execute callback a second time on replay", async () => {
    let calls = 0;
    await runOnce({ execute: () => calls++ });
    await runOnce({ execute: () => calls++ });
    await runOnce({ execute: () => calls++ });
    expect(calls).toBe(1);
  });

  it("persists exactly one idempotency record across repeated replays", async () => {
    await runOnce({ execute: () => {} });
    await runOnce({ execute: () => {} });
    await runOnce({ execute: () => {} });
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
  });

  it("marks the stored record COMPLETED with a response snapshot after success", async () => {
    await runOnce({ execute: () => {} });
    const record = await database.client.idempotencyRecord.findFirstOrThrow();
    expect(record.state).toBe("COMPLETED");
    expect(record.responseStatus).toBe(200);
    expect(record.responseBody).toBeTruthy();
    expect(record.completedAt).not.toBeNull();
    expect(record.expiresAt).not.toBeNull();
  });

  it("throws IDEMPOTENCY_PAYLOAD_MISMATCH when the same key is reused with a different payload", async () => {
    await runOnce({ payload: { amount: 1_000n }, execute: () => {} });

    await expect(
      runOnce({ payload: { amount: 2_000n }, execute: () => {} }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
  });

  it("mismatch error is an IdempotencyConflictError instance", async () => {
    await runOnce({ payload: { amount: 1_000n }, execute: () => {} });
    await expect(
      runOnce({ payload: { amount: 2_000n }, execute: () => {} }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("does not run execute again when a mismatch is detected", async () => {
    let calls = 0;
    await runOnce({ payload: { amount: 1_000n }, execute: () => calls++ });
    await expect(
      runOnce({ payload: { amount: 2_000n }, execute: () => calls++ }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("throws IDEMPOTENCY_KEY_EXPIRED once the replay window has elapsed", async () => {
    const originalNow = new Date("2026-01-01T00:00:00.000Z");
    await runOnce({ now: originalNow, execute: () => {} });

    const eightDaysLater = new Date(originalNow.getTime() + 8 * 24 * 60 * 60 * 1000);
    await expect(
      runOnce({ now: eightDaysLater, execute: () => {} }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_EXPIRED" });
  });

  it("does not treat a replay just inside the 7-day window as expired", async () => {
    const originalNow = new Date("2026-01-01T00:00:00.000Z");
    await runOnce({ now: originalNow, execute: () => {} });

    const almostSevenDaysLater = new Date(
      originalNow.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000,
    );
    const result = await runOnce({ now: almostSevenDaysLater, execute: () => {} });
    expect(result.replayed).toBe(true);
  });

  it("treats different actors as different scopes and executes both", async () => {
    let calls = 0;
    await runOnce({ actorUserId: 2, execute: () => calls++ });
    await runOnce({ actorUserId: 3, execute: () => calls++ });
    expect(calls).toBe(2);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(2);
  });

  it("treats different orders (resourceId) as different scopes and executes both", async () => {
    let calls = 0;
    await runOnce({ resourceId: 500, execute: () => calls++ });
    await runOnce({ resourceId: 501, execute: () => calls++ });
    expect(calls).toBe(2);
  });

  it("treats different raw keys for the same order as different scopes", async () => {
    let calls = 0;
    await runOnce({ rawKey: IDEMPOTENCY_TEST_KEY, execute: () => calls++ });
    await runOnce({ rawKey: IDEMPOTENCY_TEST_KEY_B, execute: () => calls++ });
    expect(calls).toBe(2);
  });
});
