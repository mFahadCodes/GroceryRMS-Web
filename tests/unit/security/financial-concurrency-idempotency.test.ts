import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
} from "./idempotency-test-database";
import {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  isFinancialConflict,
  runCheckoutIdempotent,
  runPartialIdempotent,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./financial-concurrency-harness";

describe("financial concurrency idempotency interaction", () => {
  const database = createIdempotencyTestDatabase("p0b-concurrency-idempotency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("winner same-key replay returns stored success without a second payment", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const first = await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    expect(first.replayed).toBe(false);
    const replay = await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    expect(replay.replayed).toBe(true);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
  });

  it("loser key retry revalidates and conflicts after order is completed", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    const loserKey =
      results[0]?.status === "rejected"
        ? IDEMPOTENCY_TEST_KEY
        : IDEMPOTENCY_TEST_KEY_B;

    await expect(
      runCheckoutIdempotent(database.client, fixture, { rawKey: loserKey }),
    ).rejects.toSatisfy(isFinancialConflict);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("payload mismatch remains 409 and never mutates", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      tenderedAmount: fixture.grandTotal,
    });
    await expect(
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        tenderedAmount: fixture.grandTotal + 1n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
  });

  it("partial winner replay does not create a second PARTIAL_PAYMENT audit", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 9_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 2_000n,
    });
    const replay = await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 2_000n,
    });
    expect(replay.replayed).toBe(true);
    await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(
      1,
    );
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
  });

  it("conflict responses are not stored as completed idempotency replays", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await expect(
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 100n,
      }),
    ).rejects.toSatisfy(isFinancialConflict);

    const records = await database.client.idempotencyRecord.findMany();
    expect(records).toHaveLength(1);
    expect(records[0]?.state).toBe("COMPLETED");
    expect(records[0]?.operation).toBe("order.checkout");
  });

  it("same-key in-progress semantics are unchanged for concurrent identical keys", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });
});
