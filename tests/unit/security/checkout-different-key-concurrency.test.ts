import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
} from "./idempotency-test-database";
import {
  fulfilledCount,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  IDEMPOTENCY_TEST_KEY_C,
  rejectedConflicts,
  runCheckoutIdempotent,
  seedCheckoutOrderFixture,
} from "./financial-concurrency-harness";

describe("checkout different-key concurrency", () => {
  const database = createIdempotencyTestDatabase("p0b-checkout-diff-key");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("allows only one of two different-key checkouts to complete", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
  });

  it("creates exactly one payment under different-key checkout contention", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
  });

  it("creates exactly one stock Sale movement under different-key checkout contention", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("writes exactly one CHECKOUT audit under different-key contention", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
  });

  it("persists exactly one completed idempotency record for the winner", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    const record = await database.client.idempotencyRecord.findFirstOrThrow();
    expect(record.state).toBe("COMPLETED");
  });

  it("does not overwrite winner totals when the loser conflicts", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      unitPrice: 1_500n,
      quantity: 2,
    });
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner?.status).toBe("fulfilled");

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.grandTotal).toBe(3_000n);
    expect(order.status).toBe("Closed");
  });

  it("holds under three concurrent different-key checkouts", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
      }),
    ]);
    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(2);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("deducts stock exactly once for the product", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client, {
      stock: 50,
      quantity: 3,
    });
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(47);
  });
});
