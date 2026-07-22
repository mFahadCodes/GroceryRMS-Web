import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countPayments,
  countStockMovements,
  createIdempotencyTestDatabase,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";
import {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  runCheckoutIdempotent,
  runPartialIdempotent,
} from "./financial-concurrency-harness";

describe("financial concurrency related-data invariants", () => {
  const database = createIdempotencyTestDatabase("p0b-related-data");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("concurrent checkout on one order leaves an unrelated open order untouched", async () => {
    const target = await seedCheckoutOrderFixture(database.client, {
      orderId: 100,
      productId: 10,
    });
    const otherOrder = await database.client.order.create({
      data: {
        id: 101,
        orderNumber: "ORD-101",
        orderType: "WalkIn",
        status: "Open",
        cashierId: target.user.id,
        terminalId: target.terminalId,
        subTotal: 1_000n,
        grandTotal: 1_000n,
        orderItems: {
          create: {
            productId: target.product.id,
            quantity: 1,
            unitPrice: 1_000n,
            lineTotal: 1_000n,
            status: "Open",
          },
        },
      },
    });

    await Promise.allSettled([
      runCheckoutIdempotent(database.client, target, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, target, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);

    const untouched = await database.client.order.findUniqueOrThrow({
      where: { id: otherOrder.id },
    });
    expect(untouched.status).toBe("Open");
    await expect(
      countPayments(database.client, otherOrder.id),
    ).resolves.toBe(0);
  });

  it("does not create drawer logs for an unrelated shift", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 5_000n,
      orderId: 200,
    });
    const otherShift = await database.client.shift.create({
      data: {
        userId: fixture.user.id,
        terminalId: fixture.terminalId,
        openingBalance: 1_000n,
      },
    });

    await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 5_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 5_000n,
      }),
    ]);

    await expect(
      database.client.cashDrawerLog.count({
        where: { shiftId: otherShift.id },
      }),
    ).resolves.toBe(0);
  });

  it("audit rows correspond exactly to committed mutations under contention", async () => {
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
    await expect(countAudits(database.client)).resolves.toBe(1);
  });

  it("losing partial creates no stock movement on an unrelated product", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 4_000n,
      orderId: 300,
    });
    const otherProduct = await database.client.product.create({
      data: {
        name: "Unrelated",
        categoryId: 1,
        basePrice: 100n,
        costPrice: 50n,
        currentStock: 99,
      },
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
    ]);

    await expect(
      countStockMovements(database.client, otherProduct.id),
    ).resolves.toBe(0);
    const untouched = await database.client.product.findUniqueOrThrow({
      where: { id: otherProduct.id },
    });
    expect(Number(untouched.currentStock)).toBe(99);
  });

  it("does not duplicate drawer entries when one finalizing partial wins", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client, {
      grandTotal: 7_000n,
      shiftAttached: true,
    });
    await Promise.allSettled([
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        amount: 7_000n,
      }),
      runPartialIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        amount: 7_000n,
      }),
    ]);
    await expect(
      database.client.cashDrawerLog.count({
        where: { orderId: fixture.order.id },
      }),
    ).resolves.toBe(1);
  });

  it("users and sessions tables are unchanged by order payment races", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const usersBefore = await database.client.user.count();
    const sessionsBefore = await database.client.userSession.count();
    await Promise.allSettled([
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
      }),
      runCheckoutIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ]);
    await expect(database.client.user.count()).resolves.toBe(usersBefore);
    await expect(database.client.userSession.count()).resolves.toBe(
      sessionsBefore,
    );
  });
});
