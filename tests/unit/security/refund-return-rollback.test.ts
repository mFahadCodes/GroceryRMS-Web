import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countIdempotencyRecords,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  runRefundIdempotent,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";

const FAIL_AUDIT_TRIGGER = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("refund/return rollback", () => {
  const database = createIdempotencyTestDatabase("p0c1-refund-return-rollback");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("refund audit failure rolls back counters, stock, payment, and idempotency", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 3,
      grandTotal: 9_000n,
    });
    const item = fixture.orderItems[0]!;
    const stockBefore = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(runRefundIdempotent(database.client, fixture)).rejects.toThrow();
      const source = await database.client.orderItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(source.returnedQuantity).toBe(0);
      const stockAfter = Number(
        (await database.client.product.findUniqueOrThrow({
          where: { id: fixture.product.id },
        })).currentStock,
      );
      expect(stockAfter).toBe(stockBefore);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
      await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(0);
      await expect(
        countStockMovements(database.client, fixture.product.id, "Return"),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("after refund audit rollback a later key can succeed", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(
        runRefundIdempotent(database.client, fixture, {
          rawKey: IDEMPOTENCY_TEST_KEY,
        }),
      ).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
    await runRefundIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
    });
    await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("return audit failure rolls back returnedQuantity and stock", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await database.client.$executeRawUnsafe(FAIL_AUDIT_TRIGGER);
    try {
      await expect(
        runReturnIdempotent(database.client, fixture, {
          items: [{ orderItemId: item.id, returnQty: 2 }],
          refundAmount: 4_000n,
        }),
      ).rejects.toThrow();
      const source = await database.client.orderItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(source.returnedQuantity).toBe(0);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("multi-line claim failure leaves no counters incremented", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [a, b] = fixture.orderItems;
    await expect(
      runReturnIdempotent(database.client, fixture, {
        items: [
          { orderItemId: a!.id, returnQty: 3 },
          { orderItemId: b!.id, returnQty: 9 },
        ],
        refundAmount: 10_000n,
      }),
    ).rejects.toThrow();
    const lineA = await database.client.orderItem.findUniqueOrThrow({
      where: { id: a!.id },
    });
    const lineB = await database.client.orderItem.findUniqueOrThrow({
      where: { id: b!.id },
    });
    expect(lineA.returnedQuantity).toBe(0);
    expect(lineB.returnedQuantity).toBe(0);
  });

  it("idempotency completion failure rolls back counters and stock", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 4,
      grandTotal: 8_000n,
    });
    const item = fixture.orderItems[0]!;
    const stockBefore = Number(
      (
        await database.client.product.findUniqueOrThrow({
          where: { id: fixture.product.id },
        })
      ).currentStock,
    );
    await database.client.$executeRawUnsafe(
      `CREATE TRIGGER fail_idempotency_complete BEFORE UPDATE ON idempotency_records WHEN NEW.state = 'COMPLETED' BEGIN SELECT RAISE(ABORT, 'forced idempotency completion failure'); END`,
    );
    try {
      await expect(runRefundIdempotent(database.client, fixture)).rejects.toThrow();
      const source = await database.client.orderItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(source.returnedQuantity).toBe(0);
      const stockAfter = Number(
        (
          await database.client.product.findUniqueOrThrow({
            where: { id: fixture.product.id },
          })
        ).currentStock,
      );
      expect(stockAfter).toBe(stockBefore);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
      await expect(
        countStockMovements(database.client, fixture.product.id, "Return"),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_idempotency_complete",
      );
    }
  });
});
