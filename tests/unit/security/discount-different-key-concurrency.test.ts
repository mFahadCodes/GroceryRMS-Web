import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimDiscountMutation,
  ORDER_DISCOUNT_CONFLICT,
} from "@/lib/security/discount-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";

describe("discount versus discount concurrency", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-vs-discount");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("two replacements from the same prior financial state produce one winner", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const prior = {
      discountAmount: fixture.order.discountAmount,
      taxAmount: fixture.order.taxAmount,
      grandTotal: fixture.order.grandTotal,
    };
    const nextA = {
      discountAmount: 1_000n,
      taxAmount: fixture.order.taxAmount,
      grandTotal: fixture.order.grandTotal - 1_000n,
    };
    const nextB = {
      discountAmount: 2_000n,
      taxAmount: fixture.order.taxAmount,
      grandTotal: fixture.order.grandTotal - 2_000n,
    };

    await database.client.$transaction(async (tx) => {
      await claimDiscountMutation(tx, fixture.order.id, prior, nextA);
    });

    await expect(
      database.client.$transaction(async (tx) => {
        await claimDiscountMutation(tx, fixture.order.id, prior, nextB);
      }),
    ).rejects.toMatchObject({
      code: ORDER_DISCOUNT_CONFLICT,
      status: 409,
    });

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(1_000n);
    expect(order.grandTotal).toBe(nextA.grandTotal);
  });

  it("different-key full-path race leaves at most one grant consumed when one CAS loses", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const a = await issueDiscountGrant(database.client, fixture, 30);
    const b = await issueDiscountGrant(database.client, fixture, 31);

    // Winner commits through the normal idempotent path.
    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token: a.token,
      discountAmount: 1_000n,
    });

    // Loser re-uses the pre-winner prior inside the same transaction shape as
    // production (claim before grant consume). CAS must reject; grant B stays
    // unconsumed and no second completed idempotency row is written.
    const stalePrior = {
      discountAmount: fixture.order.discountAmount,
      taxAmount: fixture.order.taxAmount,
      grandTotal: fixture.order.grandTotal,
    };
    await expect(
      database.client.$transaction(async (tx) => {
        await claimDiscountMutation(tx, fixture.order.id, stalePrior, {
          discountAmount: 2_000n,
          taxAmount: fixture.order.taxAmount,
          grandTotal: fixture.order.grandTotal - 2_000n,
        });
      }),
    ).rejects.toMatchObject({
      code: ORDER_DISCOUNT_CONFLICT,
      status: 409,
    });

    const grantA = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: a.grant.id },
    });
    const grantB = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: b.grant.id },
    });
    expect(grantA.consumedAt).not.toBeNull();
    expect(grantB.consumedAt).toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(1);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(1_000n);
  });

  it("same-grant race still leaves the losing attempt without a completed row", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 32);

    const results = await Promise.allSettled([
      runDiscountIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
        discountAmount: 300n,
      }),
      runDiscountIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token,
        discountAmount: 400n,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).not.toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("sequential replacement works after re-reading the latest Open financial state", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const first = await issueDiscountGrant(database.client, fixture, 33);
    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token: first.token,
      discountAmount: 500n,
    });

    const refreshed = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(refreshed.discountAmount).toBe(500n);

    const second = await issueDiscountGrant(database.client, fixture, 34);
    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      token: second.token,
      discountAmount: 750n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(750n);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(2);
  });
});
