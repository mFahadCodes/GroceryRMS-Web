import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyStockTake } from "@/lib/services/inventory-service";
import {
  buildApplyItems,
  createStockTakeTestDatabase,
  resetStockTakeTables,
  seedStockTakeFixture,
} from "./stock-take-test-database";

describe("stock-take-concurrency", () => {
  const database = createStockTakeTestDatabase("inv2-stock-take-concurrency");

  beforeEach(async () => {
    await resetStockTakeTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("one-shot apply: applying an already completed stock take throws STOCK_TAKE_NOT_IN_PROGRESS", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      status: "Completed",
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15, 25]);

    await expect(
      applyStockTake(
        fixture.stockTake.id,
        applyItems,
        fixture.user.id,
        "127.0.0.1",
        { client: database.client },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "STOCK_TAKE_NOT_IN_PROGRESS",
        status: 409,
      }),
    );
  });

  it("applying a cancelled stock take throws STOCK_TAKE_NOT_IN_PROGRESS", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      status: "Cancelled",
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15, 25]);

    await expect(
      applyStockTake(
        fixture.stockTake.id,
        applyItems,
        fixture.user.id,
        "127.0.0.1",
        { client: database.client },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "STOCK_TAKE_NOT_IN_PROGRESS",
        status: 409,
      }),
    );
  });

  it("CAS claim race: only one of parallel apply requests succeeds and the second fails closed", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [12]);

    // First call succeeds
    const firstCall = applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      { client: database.client },
    );
    await expect(firstCall).resolves.toBeDefined();

    // Second call immediately fails because status is now Completed
    const secondCall = applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      { client: database.client },
    );
    await expect(secondCall).rejects.toThrowError(
      expect.objectContaining({
        code: "STOCK_TAKE_NOT_IN_PROGRESS",
        status: 409,
      }),
    );
  });

  it("stale stock rejection: throws STOCK_TAKE_STALE_STOCK if product stock was modified after stock take creation", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    // Simulate a sale or stock movement modifying product 10 currentStock to 8
    await database.client.product.update({
      where: { id: 10 },
      data: { currentStock: 8 },
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [12]);

    await expect(
      applyStockTake(
        fixture.stockTake.id,
        applyItems,
        fixture.user.id,
        "127.0.0.1",
        { client: database.client },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "STOCK_TAKE_STALE_STOCK",
        status: 409,
      }),
    );
  });
});
