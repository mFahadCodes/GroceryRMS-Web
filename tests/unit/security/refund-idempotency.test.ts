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
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";

describe("refund idempotency", () => {
  const database = createIdempotencyTestDatabase("p0c1-refund-idempotency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("executes a refund once and stores a completed idempotency record", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    const result = await runRefundIdempotent(database.client, fixture);
    expect(result.replayed).toBe(false);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(1);
  });

  it("matching same-key replay returns stored success without a second refund", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await runRefundIdempotent(database.client, fixture);
    const replay = await runRefundIdempotent(database.client, fixture);
    expect(replay.replayed).toBe(true);
    await expect(countAudits(database.client, "REFUND_ORDER")).resolves.toBe(1);
    const refundOrders = await database.client.order.count({
      where: { originalOrderId: fixture.order.id, orderType: "Refund" },
    });
    expect(refundOrders).toBe(1);
  });

  it("same key with different amount is a payload mismatch", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      grandTotal: 10_000n,
      quantity: 5,
    });
    await runRefundIdempotent(database.client, fixture, { amount: 4_000n });
    await expect(
      runRefundIdempotent(database.client, fixture, { amount: 5_000n }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("same key with different reason is a payload mismatch", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await runRefundIdempotent(database.client, fixture, { reason: "a" });
    await expect(
      runRefundIdempotent(database.client, fixture, { reason: "b" }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("different keys on an already fully refunded order conflict without a second payment", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await runRefundIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await expect(
      runRefundIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
      }),
    ).rejects.toThrow();
    const refundPayments = await database.client.payment.count({
      where: { status: "Refunded" },
    });
    expect(refundPayments).toBe(1);
  });

  it("sets returnedQuantity to sold quantity and stores sourceOrderItemId lineage", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 4,
      grandTotal: 8_000n,
    });
    await runRefundIdempotent(database.client, fixture);
    const sourceItem = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(sourceItem.returnedQuantity).toBe(4);
    const child = await database.client.orderItem.findFirstOrThrow({
      where: { sourceOrderItemId: sourceItem.id },
    });
    expect(child.quantity).toBe(-4);
  });

  it("creates exactly one stock Return movement for a successful refund", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client);
    await runRefundIdempotent(database.client, fixture);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(1);
  });
});
