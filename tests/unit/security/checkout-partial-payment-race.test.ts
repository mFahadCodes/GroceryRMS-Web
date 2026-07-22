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
  isFinancialConflict,
  rejectedConflicts,
  runCheckoutIdempotent,
  runPartialIdempotent,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./financial-concurrency-harness";

describe("checkout versus partial-payment races", () => {
  const database = createIdempotencyTestDatabase("p0b-checkout-partial-race");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("when checkout wins, concurrent partial creates no payment", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 4_000n,
      }),
    ]);

    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "PARTIAL_PAYMENT")).resolves.toBe(
      0,
    );
  });

  it("when a non-final partial commits first, checkout still requires Open and conflicts", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 3_000n,
    });

    await expect(
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ).rejects.toSatisfy(isFinancialConflict);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(0);
  });

  it("when a finalizing partial wins, concurrent checkout conflicts without duplicate stock", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 8_000n,
    });
    const results = await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 8_000n,
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
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);

    const paymentCount = await countPayments(database.client, fixture.order.id);
    expect(paymentCount).toBeGreaterThanOrEqual(1);
    expect(paymentCount).toBeLessThanOrEqual(1);

    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(8_000n);
  });

  it("checkout-versus-final-partial creates exactly one success audit among CHECKOUT/PARTIAL_PAYMENT", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
    });
    await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 5_000n,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);

    const checkoutAudits = await countAudits(database.client, "CHECKOUT");
    const partialAudits = await countAudits(database.client, "PARTIAL_PAYMENT");
    expect(checkoutAudits + partialAudits).toBe(1);
  });

  it("loser leaves no completed idempotency record", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 7_000n,
    });
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 7_000n,
      }),
    ]);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("after checkout, a later partial with a new key conflicts", async () => {
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
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(1);
  });
});
