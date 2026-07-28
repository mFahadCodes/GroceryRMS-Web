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
import { runUpdateItemQuantityIdempotent } from "./cart-mutation-idempotency-test-harness";

describe("order update-item-quantity idempotency", () => {
  const database = createIdempotencyTestDatabase("p1a-update-item-quantity-idempotency");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("updates quantity once and records a completed idempotency row", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const orderItemId = fixture.order.orderItems[0]!.id;

    const result = await runUpdateItemQuantityIdempotent(database.client, fixture, {
      orderItemId,
      quantity: 5,
    });
    expect(result.replayed).toBe(false);

    const item = await database.client.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
    });
    expect(item.quantity).toBe(5);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "PATCH_ORDER_ITEM")).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-mutating", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const orderItemId = fixture.order.orderItems[0]!.id;
    await runUpdateItemQuantityIdempotent(database.client, fixture, {
      orderItemId,
      quantity: 4,
    });
    const before = await database.client.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
    });

    const replay = await runUpdateItemQuantityIdempotent(database.client, fixture, {
      orderItemId,
      quantity: 4,
    });
    expect(replay.replayed).toBe(true);

    const after = await database.client.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
    });
    expect(after.quantity).toBe(before.quantity);
    await expect(countAudits(database.client, "PATCH_ORDER_ITEM")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("same key with different quantity is a payload mismatch", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const orderItemId = fixture.order.orderItems[0]!.id;
    await runUpdateItemQuantityIdempotent(database.client, fixture, {
      orderItemId,
      quantity: 3,
    });
    await expect(
      runUpdateItemQuantityIdempotent(database.client, fixture, {
        orderItemId,
        quantity: 4,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countAudits(database.client, "PATCH_ORDER_ITEM")).resolves.toBe(1);
  });
});
