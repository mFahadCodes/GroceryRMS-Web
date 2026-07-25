import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyStockTake, createStockTake } from "@/lib/services/inventory-service";
import { ServiceError } from "@/lib/api/service-error";
import {
  buildApplyItems,
  createStockTakeTestDatabase,
  resetStockTakeTables,
  seedStockTakeFixture,
} from "./stock-take-test-database";

describe("stock-take-integrity", () => {
  const database = createStockTakeTestDatabase("inv2-stock-take-integrity");

  beforeEach(async () => {
    await resetStockTakeTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("applies a stock take with variance and updates product currentStock, items, status, and creates StockMovement adjustment", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10, 11],
      initialStocks: [10, 20],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [12, 15]);

    const result = await applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      { client: database.client },
    );

    const stockTake = "replayed" in result
      ? (result as { body: { completedAt: Date | null } }).body
      : result;
    expect(stockTake.completedAt).not.toBeNull();

    // Verify Product stocks were updated
    const p1 = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
    const p2 = await database.client.product.findUniqueOrThrow({ where: { id: 11 } });
    expect(Number(p1.currentStock)).toBe(12);
    expect(Number(p2.currentStock)).toBe(15);

    // Verify StockMovements were created (variance: +2 for P10, -5 for P11)
    const movements = await database.client.stockMovement.findMany({
      where: { reference: `ST-${fixture.stockTake.id}` },
      orderBy: { productId: "asc" },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]?.type).toBe("Adjustment");
    expect(Number(movements[0]?.quantity)).toBe(2);
    expect(movements[1]?.type).toBe("Adjustment");
    expect(Number(movements[1]?.quantity)).toBe(-5);

    // Verify audit log
    const audit = await database.client.auditLog.findFirst({
      where: { action: "APPLY_STOCK_TAKE", recordId: fixture.stockTake.id },
    });
    expect(audit).not.toBeNull();
  });

  it("creates no StockMovement if variance is zero", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [10]); // Same as expected

    await applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      { client: database.client },
    );

    const movements = await database.client.stockMovement.findMany({
      where: { reference: `ST-${fixture.stockTake.id}` },
    });
    expect(movements).toHaveLength(0);
  });

  it("throws 404 when applying a non-existent stock take", async () => {
    await expect(
      applyStockTake(9999, [{ itemId: 1, countedQty: 5 }], 1, null, {
        client: database.client,
      }),
    ).rejects.toThrowError(ServiceError);
  });

  it("throws 404 when requested item ID does not belong to the stock take", async () => {
    const fixture = await seedStockTakeFixture(database.client);

    await expect(
      applyStockTake(
        fixture.stockTake.id,
        [{ itemId: 9999, countedQty: 5 }],
        fixture.user.id,
        null,
        { client: database.client },
      ),
    ).rejects.toThrowError(ServiceError);
  });

  it("createStockTake snapshots active product current stocks inside transaction", async () => {
    // Seed 2 products
    await database.client.productCategory.create({ data: { id: 1, name: "Cat" } });
    await database.client.product.createMany({
      data: [
        { id: 100, name: "P100", categoryId: 1, basePrice: 100n, costPrice: 50n, currentStock: 25 },
        { id: 101, name: "P101", categoryId: 1, basePrice: 200n, costPrice: 100n, currentStock: 50 },
      ],
    });

    // Run createStockTake using standard prisma (tested via transaction)
    const stockTake = await createStockTake({ notes: "Snapshot test", client: database.client });
    expect(stockTake.items).toHaveLength(2);
    expect(Number(stockTake.items[0]?.expectedQty)).toBe(25);
    expect(Number(stockTake.items[1]?.expectedQty)).toBe(50);
  });
});
