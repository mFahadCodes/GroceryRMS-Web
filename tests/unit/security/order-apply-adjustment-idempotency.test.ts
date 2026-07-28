import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  resetMutableOrderTables,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";
import { runApplyAdjustmentIdempotent } from "./cart-mutation-idempotency-test-harness";

describe("order apply-adjustment idempotency", () => {
  const database = createIdempotencyTestDatabase("p1a-apply-adjustment-idempotency");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("applies adjustment once and records a completed idempotency row", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const result = await runApplyAdjustmentIdempotent(database.client, fixture, {
      adjustment: -500n,
    });
    expect(result.replayed).toBe(false);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.adjustment).toBe(-500n);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-mutating", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await runApplyAdjustmentIdempotent(database.client, fixture, {
      adjustment: -300n,
    });
    const before = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });

    const replay = await runApplyAdjustmentIdempotent(database.client, fixture, {
      adjustment: -300n,
    });
    expect(replay.replayed).toBe(true);

    const after = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(after.adjustment).toBe(before.adjustment);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("same key with different adjustment is a payload mismatch", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await runApplyAdjustmentIdempotent(database.client, fixture, {
      adjustment: -500n,
    });
    await expect(
      runApplyAdjustmentIdempotent(database.client, fixture, {
        adjustment: -600n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      countAudits(database.client, "UPDATE_ORDER_ADJUSTMENT"),
    ).resolves.toBe(1);
  });
});
