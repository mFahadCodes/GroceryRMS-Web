import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { StockTake } from "@prisma/client";
import { applyStockTake } from "@/lib/services/inventory-service";
import type { FinancialIdempotentResult } from "@/lib/services/idempotency-service";
import {
  buildApplyItems,
  createStockTakeTestDatabase,
  resetStockTakeTables,
  seedStockTakeFixture,
  STOCK_TAKE_TEST_KEY_A,
  STOCK_TAKE_TEST_KEY_B,
} from "./stock-take-test-database";

describe("stock-take-idempotency", () => {
  const database = createStockTakeTestDatabase("inv2-stock-take-idempotency");

  beforeEach(async () => {
    await resetStockTakeTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("replays completed stock-take apply result idempotently without duplicate adjustments or audit logs", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]); // Variance: +5

    // Initial execution with idempotency key
    const firstResult = (await applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      {
        rawKey: STOCK_TAKE_TEST_KEY_A,
        authoritativeTerminalId: 1,
        client: database.client,
      },
    )) as FinancialIdempotentResult<StockTake>;

    expect(firstResult.replayed).toBe(false);
    expect(firstResult.status).toBe(200);
    expect(firstResult.body.status).toBe("Completed");

    // Second execution with same key and payload
    const secondResult = (await applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      {
        rawKey: STOCK_TAKE_TEST_KEY_A,
        authoritativeTerminalId: 1,
        client: database.client,
      },
    )) as FinancialIdempotentResult<StockTake>;

    expect(secondResult.replayed).toBe(true);
    expect(secondResult.status).toBe(200);

    // Verify product currentStock remains 15 (not incremented twice)
    const product = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
    expect(Number(product.currentStock)).toBe(15);

    // Verify exactly ONE StockMovement was recorded
    const movements = await database.client.stockMovement.findMany({
      where: { reference: `ST-${fixture.stockTake.id}` },
    });
    expect(movements).toHaveLength(1);

    // Verify exactly ONE AuditLog was recorded
    const audits = await database.client.auditLog.findMany({
      where: { action: "APPLY_STOCK_TAKE", recordId: fixture.stockTake.id },
    });
    expect(audits).toHaveLength(1);

    // Verify IdempotencyRecord state is COMPLETED
    const idempotencyRecords = await database.client.idempotencyRecord.findMany();
    expect(idempotencyRecords).toHaveLength(1);
    expect(idempotencyRecords[0]?.resourceType).toBe("stock_takes");
    expect(idempotencyRecords[0]?.operation).toBe("inventory.stock-take-apply");
    expect(idempotencyRecords[0]?.state).toBe("COMPLETED");
  });

  it("throws IDEMPOTENCY_PAYLOAD_MISMATCH when key is reused with a different payload", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]);

    // Initial execution
    await applyStockTake(
      fixture.stockTake.id,
      applyItems,
      fixture.user.id,
      "127.0.0.1",
      {
        rawKey: STOCK_TAKE_TEST_KEY_B,
        authoritativeTerminalId: 1,
        client: database.client,
      },
    );

    // Same key, different counted quantity (different payload)
    const differentItems = buildApplyItems(fixture.stockTake.items, [20]);

    await expect(
      applyStockTake(
        fixture.stockTake.id,
        differentItems,
        fixture.user.id,
        "127.0.0.1",
        {
          rawKey: STOCK_TAKE_TEST_KEY_B,
          authoritativeTerminalId: 1,
          client: database.client,
        },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      }),
    );
  });
});
