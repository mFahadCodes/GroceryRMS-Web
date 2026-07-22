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
  runPartialIdempotent,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./financial-concurrency-harness";

describe("order finalization race", () => {
  const database = createIdempotencyTestDatabase("p0b-finalization-race");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("at most one request finalizes when checkout and full partial race", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 12_000n,
    });
    const results = await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 12_000n,
      }),
    ]);
    expect(fulfilledCount(results)).toBe(1);
    expect(rejectedConflicts(results)).toBe(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
  });

  it("at most one stock Sale when three finalizing contenders race", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 4_000n,
    });
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
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
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(1);
  });

  it("marks all payments Paid when a finalizing partial wins", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 4_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      amount: 6_000n,
    });
    const payments = await database.client.payment.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(payments).toHaveLength(2);
    expect(payments.every((payment) => payment.status === "Paid")).toBe(true);
  });

  it("does not invoke a second finalization after the order is Closed", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    await runCheckoutIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    const stockBefore = await countStockMovements(
      database.client,
      fixture.product.id,
      "Sale",
    );
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
        amount: fixture.grandTotal,
      }),
    ]);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(stockBefore);
    await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
  });

  it("non-final partial does not finalize or decrement stock", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 10_000n,
    });
    await runPartialIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      amount: 1_000n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    await expect(
      countStockMovements(database.client, fixture.product.id, "Sale"),
    ).resolves.toBe(0);
  });

  it("final paid amount equals committed payments exactly", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 11_000n,
    });
    await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 5_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 6_000n,
      }),
    ]);
    const paid = await database.client.payment.aggregate({
      where: { orderId: fixture.order.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(11_000n);
    await expect(
      countPayments(database.client, fixture.order.id),
    ).resolves.toBe(2);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(2);
  });
});
