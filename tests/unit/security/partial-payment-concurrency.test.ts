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
  runPartialIdempotent,
  seedPartialPaymentOrderFixture,
} from "./financial-concurrency-harness";

describe("partial-payment different-key concurrency", () => {
  const database = createIdempotencyTestDatabase("p0b-partial-concurrency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("accepts two concurrent partials whose sum is below the balance", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 3_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(2);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(7_000n);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(0);
  });

  it("when two partials sum exactly to the balance, closes once with one stock Sale", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 6_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(2);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(10_000n);
  });

  it("when two partials would collectively overpay, only a safe subset commits", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 7_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 7_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);

    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(7_000n);
    expect(paid._sum.amount! <= 10_000n).toBe(true);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("rejects two concurrent full-balance payments so only one finalizes", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 9_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 9_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 9_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(
      1,
    );
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(9_000n);
  });

  it("treats same amounts with different keys as distinct attempts against remaining", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 3_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 3_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(3_000n);
  });

  it("never produces a negative remaining balance after concurrent partials", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 6_000n,
    });
    await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 4_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
        amount: 4_000n,
      }),
    ]);

    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount ?? 0n).toBeLessThanOrEqual(6_000n);
    const remaining = 6_000n - (paid._sum.amount ?? 0n);
    expect(remaining >= 0n).toBe(true);
  });

  it("single-request amount above remaining is rejected without mutation", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 2_000n,
    });
    await expect(
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
    ).rejects.toThrow(/exceeds remaining/i);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });
});
