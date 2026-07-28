import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  ensureSecondTaxRate,
  resetMutableOrderTables,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";
import { runApplyTaxIdempotent } from "./cart-mutation-idempotency-test-harness";

describe("order apply-tax idempotency", () => {
  const database = createIdempotencyTestDatabase("p1a-apply-tax-idempotency");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("applies tax once and records a completed idempotency row", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    expect(fixture.taxRateId).not.toBeNull();

    const result = await runApplyTaxIdempotent(database.client, fixture, {
      taxRateId: fixture.taxRateId!,
    });
    expect(result.replayed).toBe(false);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.taxRateId).toBe(fixture.taxRateId);
    expect(order.taxAmount).toBeGreaterThan(0n);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "APPLY_ORDER_TAX")).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-mutating", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    await runApplyTaxIdempotent(database.client, fixture, {
      taxRateId: fixture.taxRateId!,
    });
    const before = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });

    const replay = await runApplyTaxIdempotent(database.client, fixture, {
      taxRateId: fixture.taxRateId!,
    });
    expect(replay.replayed).toBe(true);

    const after = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(after.taxAmount).toBe(before.taxAmount);
    await expect(countAudits(database.client, "APPLY_ORDER_TAX")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("same key with different taxRateId is a payload mismatch", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      taxPercent: 10,
    });
    const secondRate = await ensureSecondTaxRate(database.client);
    await runApplyTaxIdempotent(database.client, fixture, {
      taxRateId: fixture.taxRateId!,
    });
    await expect(
      runApplyTaxIdempotent(database.client, fixture, {
        taxRateId: secondRate.id,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countAudits(database.client, "APPLY_ORDER_TAX")).resolves.toBe(1);
  });
});
