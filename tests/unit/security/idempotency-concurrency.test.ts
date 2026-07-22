import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
} from "./idempotency-test-database";

describe("executeFinancialIdempotent concurrency", () => {
  const database = createIdempotencyTestDatabase("p0a-concurrency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  let counter = { calls: 0 };

  function attempt(overrides: {
    rawKey?: string;
    resourceId?: number;
    actorUserId?: number;
  } = {}) {
    return executeFinancialIdempotent({
      rawKey: overrides.rawKey ?? IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: overrides.resourceId ?? 900,
      actorUserId: overrides.actorUserId ?? 2,
      authoritativeTerminalId: 1,
      requestPayload: { amount: 1_000n },
      client: database.client,
      execute: async (tx) => {
        counter.calls += 1;
        const method = await tx.paymentMethod.create({
          data: { name: `Concurrency-${Math.random()}` },
        });
        return { status: 200, body: { paymentMethodId: method.id } };
      },
    });
  }

  /**
   * The loser of a race either replays a COMPLETED record it observed after
   * the unique-constraint retry, or observes IN_PROGRESS and must be
   * retried by the caller (mirroring real client retry behavior) until the
   * winner's transaction commits.
   */
  async function retryUntilSettled(
    fn: () => ReturnType<typeof attempt>,
    maxAttempts = 10,
  ) {
    let lastError: unknown;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof Error) ||
          !/IDEMPOTENCY_IN_PROGRESS|already in progress/i.test(error.message)
        ) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  beforeEach(() => {
    counter = { calls: 0 };
  });

  it("runs the mutation exactly once for two concurrent calls with the same key", async () => {
    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(counter.calls).toBe(1);
  });

  it("persists exactly one idempotency record after the race settles (with retry for any IN_PROGRESS loser)", async () => {
    const results = await Promise.allSettled([attempt(), attempt()]);
    for (const result of results) {
      if (result.status === "rejected") {
        await retryUntilSettled(() => attempt());
      }
    }
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
    const record = await database.client.idempotencyRecord.findFirstOrThrow();
    expect(record.state).toBe("COMPLETED");
  });

  it("the winner reports replayed:false and any eventual retry reports replayed:true", async () => {
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilledResults = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>> =>
        r.status === "fulfilled",
    );
    expect(fulfilledResults.some((r) => r.value.replayed === false)).toBe(true);

    // Whatever settled as rejected must, on retry, resolve as a replay —
    // never as a second real mutation.
    for (const result of results) {
      if (result.status === "rejected") {
        const retried = await retryUntilSettled(() => attempt());
        expect(retried.replayed).toBe(true);
      }
    }
    expect(counter.calls).toBe(1);
  });

  it("holds under three concurrent calls with the same key — still exactly one mutation and one record", async () => {
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    for (const result of results) {
      if (result.status === "rejected") {
        await retryUntilSettled(() => attempt());
      }
    }
    expect(counter.calls).toBe(1);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(1);
  });

  it("does not let concurrent contention on one scope block a completely different scope", async () => {
    const [sameScope, otherScope] = await Promise.allSettled([
      attempt({ resourceId: 900 }),
      attempt({ resourceId: 901 }),
    ]);

    expect(otherScope.status).toBe("fulfilled");
    if (otherScope.status === "fulfilled") {
      expect(otherScope.value.replayed).toBe(false);
    }
    // The resourceId:900 call above always succeeds alone (no contender),
    // so both should be independent successes with two total mutations.
    expect(sameScope.status).toBe("fulfilled");
    expect(counter.calls).toBe(2);
  });

  it("concurrent calls with different raw keys on the same order both succeed as separate scopes", async () => {
    const results = await Promise.allSettled([
      attempt({ rawKey: IDEMPOTENCY_TEST_KEY }),
      attempt({ rawKey: IDEMPOTENCY_TEST_KEY_B }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(counter.calls).toBe(2);
    await expect(database.client.idempotencyRecord.count()).resolves.toBe(2);
  });
});
