import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";
import { applyOrderDiscount } from "@/lib/services/order-service";

describe("discount manager approval replay", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-approval-replay");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("matching replay requires no fresh approval token", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 80);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 300n,
    });
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      discountAmount: 300n,
    });
    expect(replay.replayed).toBe(true);
  });

  it("matching replay works with the already-consumed original token", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 81);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 200n,
    });
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 200n,
    });
    expect(replay.replayed).toBe(true);
  });

  it("original execution without a valid approval remains rejected", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await expect(
      database.client.$transaction(async (tx) =>
        applyOrderDiscount(
          {
            orderId: fixture.order.id,
            discountAmount: 100n,
            approvalToken: "ccccccccccccccccccccccccccccccccccccccccccc",
            requester: fixture.requesterContext,
          },
          tx,
        ),
      ),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
  });

  it("original execution with a malformed approval token remains rejected", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token: "not-a-valid-token",
        discountAmount: 100n,
      }),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
  });

  it("replay does not consume a freshly issued unused grant", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const original = await issueDiscountGrant(database.client, fixture, 82);
    await runDiscountIdempotent(database.client, fixture, {
      token: original.token,
      discountAmount: 150n,
    });
    const unused = await issueDiscountGrant(database.client, fixture, 83);
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token: unused.token,
      discountAmount: 150n,
    });
    expect(replay.replayed).toBe(true);
    const unusedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: unused.grant.id },
    });
    expect(unusedGrant.consumedAt).toBeNull();
  });

  it("second original execution with a consumed token fails without mutating again", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 84);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 175n,
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 175n,
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(175n);
  });
});