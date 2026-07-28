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
import { runAddItemIdempotent } from "./cart-mutation-idempotency-test-harness";

describe("order add-item idempotency", () => {
  const database = createIdempotencyTestDatabase("p1a-add-item-idempotency");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("adds an item once and records a completed idempotency row", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const beforeCount = await database.client.orderItem.count({
      where: { orderId: fixture.order.id, status: { not: "Void" } },
    });

    const result = await runAddItemIdempotent(database.client, fixture, {
      productId: fixture.product.id,
      quantity: 1,
    });
    expect(result.replayed).toBe(false);

    const afterCount = await database.client.orderItem.count({
      where: { orderId: fixture.order.id, status: { not: "Void" } },
    });
    expect(afterCount).toBe(beforeCount);
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id, productId: fixture.product.id },
    });
    expect(item.quantity).toBe(fixture.quantity + 1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-mutating", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await runAddItemIdempotent(database.client, fixture, {
      productId: fixture.product.id,
      quantity: 2,
    });
    const before = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id, productId: fixture.product.id },
    });

    const replay = await runAddItemIdempotent(database.client, fixture, {
      productId: fixture.product.id,
      quantity: 2,
    });
    expect(replay.replayed).toBe(true);

    const after = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id, productId: fixture.product.id },
    });
    expect(after.quantity).toBe(before.quantity);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("same key with different quantity is a payload mismatch", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await runAddItemIdempotent(database.client, fixture, {
      productId: fixture.product.id,
      quantity: 1,
    });
    await expect(
      runAddItemIdempotent(database.client, fixture, {
        productId: fixture.product.id,
        quantity: 2,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(1);
  });
});
