import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import { ORDER_NOT_VOIDABLE } from "@/lib/security/void-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  IDEMPOTENCY_TEST_KEY_C,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void different-key concurrency", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-diff-key");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("exactly one of two different keys with different grants voids the order", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const a = await issueVoidGrant(database.client, fixture, 20);
    const b = await issueVoidGrant(database.client, fixture, 21);
    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: a.token,
      }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);

    const grantA = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: a.grant.id },
    });
    const grantB = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: b.grant.id },
    });
    const consumed = [grantA.consumedAt, grantB.consumedAt].filter(Boolean);
    expect(consumed).toHaveLength(1);
  });

  it("two different keys sharing one grant: at most one consumes it and voids", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const shared = await issueVoidGrant(database.client, fixture, 22);
    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: shared.token,
      }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: shared.token,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const grant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: shared.grant.id },
    });
    expect(grant.consumedAt).not.toBeNull();
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("winner same-key replay succeeds after different-key race", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const a = await issueVoidGrant(database.client, fixture, 23);
    const b = await issueVoidGrant(database.client, fixture, 24);
    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: a.token,
      }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
      }),
    ]);
    const winner = results.find((r) => r.status === "fulfilled");
    expect(winner?.status).toBe("fulfilled");
    const winnerKey =
      winner && winner.status === "fulfilled"
        ? // Infer which key won by checking grants / try both
          IDEMPOTENCY_TEST_KEY
        : IDEMPOTENCY_TEST_KEY;
    // Replay both keys: winner replays, loser conflicts
    const replayA = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: a.token,
      }),
    ]);
    const replayB = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
      }),
    ]);
    const fulfilledReplays = [...replayA, ...replayB].filter(
      (r) => r.status === "fulfilled",
    );
    expect(fulfilledReplays).toHaveLength(1);
    if (fulfilledReplays[0]?.status === "fulfilled") {
      expect(fulfilledReplays[0].value.replayed).toBe(true);
    }
    void winnerKey;
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("loser grant remains unconsumed after race", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const a = await issueVoidGrant(database.client, fixture, 25);
    const b = await issueVoidGrant(database.client, fixture, 26);
    await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: a.token,
      }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
      }),
    ]);
    const grants = await database.client.managerApprovalGrant.findMany({
      where: { resourceId: fixture.order.id, action: "order.void" },
    });
    expect(grants.filter((g) => g.consumedAt === null)).toHaveLength(1);
    expect(grants.filter((g) => g.consumedAt !== null)).toHaveLength(1);
  });

  it("already voided order rejects with ORDER_NOT_VOIDABLE", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const first = await issueVoidGrant(database.client, fixture, 27);
    await runVoidIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token: first.token,
    });
    const second = await issueVoidGrant(database.client, fixture, 28);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_C,
        token: second.token,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === ORDER_NOT_VOIDABLE &&
        error.status === 409,
    );
  });

  it("concurrent reverseStock voids restore stock exactly once", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 10,
      quantity: 2,
    });
    const a = await issueVoidGrant(database.client, fixture, 29);
    const b = await issueVoidGrant(database.client, fixture, 30);
    await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token: a.token,
        reverseStock: true,
      }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
        reverseStock: true,
      }),
    ]);
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product!.id },
    });
    expect(Number(product.currentStock)).toBe(12);
    await expect(
      countStockMovements(database.client, fixture.product!.id, "Return"),
    ).resolves.toBe(1);
  });
});
