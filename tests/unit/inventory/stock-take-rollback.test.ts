import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyStockTake } from "@/lib/services/inventory-service";
import {
  buildApplyItems,
  createStockTakeTestDatabase,
  installStockTakeFailureTrigger,
  resetStockTakeTables,
  seedStockTakeFixture,
  STOCK_TAKE_TEST_KEY_A,
} from "./stock-take-test-database";

describe("stock-take-rollback", () => {
  const database = createStockTakeTestDatabase("inv2-stock-take-rollback");

  beforeEach(async () => {
    await resetStockTakeTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("audit insertion failure rolls back stock-take status, product stock, and stock movements", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]);

    await installStockTakeFailureTrigger(database.client, {
      name: "fail_audit_insert",
      table: "audit_logs",
      timing: "INSERT",
    });

    try {
      await expect(
        applyStockTake(
          fixture.stockTake.id,
          applyItems,
          fixture.user.id,
          "127.0.0.1",
          { client: database.client },
        ),
      ).rejects.toThrow();

      // Verify stock take status is still InProgress
      const st = await database.client.stockTake.findUniqueOrThrow({
        where: { id: fixture.stockTake.id },
      });
      expect(st.status).toBe("InProgress");
      expect(st.completedAt).toBeNull();

      // Verify product stock is still 10
      const prod = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
      expect(Number(prod.currentStock)).toBe(10);

      // Verify 0 stock movements exist
      const movements = await database.client.stockMovement.count();
      expect(movements).toBe(0);
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    }
  });

  it("product stock update failure rolls back CAS completion and stock movements", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]);

    await installStockTakeFailureTrigger(database.client, {
      name: "fail_product_update",
      table: "products",
      timing: "UPDATE",
    });

    try {
      await expect(
        applyStockTake(
          fixture.stockTake.id,
          applyItems,
          fixture.user.id,
          "127.0.0.1",
          { client: database.client },
        ),
      ).rejects.toThrow();

      const st = await database.client.stockTake.findUniqueOrThrow({
        where: { id: fixture.stockTake.id },
      });
      expect(st.status).toBe("InProgress");

      const audits = await database.client.auditLog.count();
      expect(audits).toBe(0);
    } finally {
      await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_product_update");
    }
  });

  it("stock movement insert failure rolls back CAS completion and product stock", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]);

    await installStockTakeFailureTrigger(database.client, {
      name: "fail_stock_movement_insert",
      table: "stock_movements",
      timing: "INSERT",
    });

    try {
      await expect(
        applyStockTake(
          fixture.stockTake.id,
          applyItems,
          fixture.user.id,
          "127.0.0.1",
          { client: database.client },
        ),
      ).rejects.toThrow();

      const st = await database.client.stockTake.findUniqueOrThrow({
        where: { id: fixture.stockTake.id },
      });
      expect(st.status).toBe("InProgress");

      const prod = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
      expect(Number(prod.currentStock)).toBe(10);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_stock_movement_insert",
      );
    }
  });

  it("idempotency record completion failure rolls back the entire stock take transaction", async () => {
    const fixture = await seedStockTakeFixture(database.client, {
      productIds: [10],
      initialStocks: [10],
    });

    const applyItems = buildApplyItems(fixture.stockTake.items, [15]);

    await installStockTakeFailureTrigger(database.client, {
      name: "fail_idempotency_complete",
      table: "idempotency_records",
      timing: "UPDATE",
      when: "NEW.state = 'COMPLETED'",
    });

    try {
      await expect(
        applyStockTake(
          fixture.stockTake.id,
          applyItems,
          fixture.user.id,
          "127.0.0.1",
          {
            rawKey: STOCK_TAKE_TEST_KEY_A,
            authoritativeTerminalId: 1,
            client: database.client,
          },
        ),
      ).rejects.toThrow();

      const st = await database.client.stockTake.findUniqueOrThrow({
        where: { id: fixture.stockTake.id },
      });
      expect(st.status).toBe("InProgress");

      const prod = await database.client.product.findUniqueOrThrow({ where: { id: 10 } });
      expect(Number(prod.currentStock)).toBe(10);

      const audits = await database.client.auditLog.count();
      expect(audits).toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_idempotency_complete",
      );
    }
  });
});
