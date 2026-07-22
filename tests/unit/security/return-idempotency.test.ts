import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
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
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";

describe("return idempotency", () => {
  const database = createIdempotencyTestDatabase("p0c1-return-idempotency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("executes a return once with completed idempotency and RETURN audit", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const result = await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    expect(result.replayed).toBe(false);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "RETURN")).resolves.toBe(1);
  });

  it("matching replay does not restore stock twice", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    const stockBefore = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    const stockAfter = Number(
      (await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product.id },
      })).currentStock,
    );
    expect(stockAfter).toBe(stockBefore + 2);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(1);
  });

  it("changed return quantity is a payload mismatch", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    await expect(
      runReturnIdempotent(database.client, fixture, {
        items: [{ orderItemId: item.id, returnQty: 3 }],
        refundAmount: 4_000n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("item array order does not change the request digest", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      secondLineSameProduct: true,
      grandTotal: 10_000n,
      quantity: 5,
    });
    const [a, b] = fixture.orderItems;
    const first = await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [
        { orderItemId: a!.id, returnQty: 1 },
        { orderItemId: b!.id, returnQty: 1 },
      ],
      refundAmount: 4_000n,
    });
    expect(first.replayed).toBe(false);
    const replay = await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [
        { orderItemId: b!.id, returnQty: 1 },
        { orderItemId: a!.id, returnQty: 1 },
      ],
      refundAmount: 4_000n,
    });
    expect(replay.replayed).toBe(true);
  });

  it("increments returnedQuantity and sets sourceOrderItemId on child lines", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      items: [{ orderItemId: item.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(3);
    const child = await database.client.orderItem.findFirstOrThrow({
      where: { sourceOrderItemId: item.id },
    });
    expect(child.quantity).toBe(-3);
  });

  it("second different-key return of remaining units succeeds", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      items: [{ orderItemId: item.id, returnQty: 2 }],
      refundAmount: 4_000n,
    });
    await runReturnIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      items: [{ orderItemId: item.id, returnQty: 3 }],
      refundAmount: 6_000n,
    });
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(5);
  });
});
