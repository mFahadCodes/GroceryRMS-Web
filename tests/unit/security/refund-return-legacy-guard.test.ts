import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RETURN_HISTORY_RECONCILIATION_REQUIRED } from "@/lib/security/refund-return-concurrency";
import { ServiceError } from "@/lib/api/service-error";
import {
  countIdempotencyRecords,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  runReturnIdempotent,
  seedClosedPaidOrderFixture,
} from "./refund-return-test-harness";

describe("legacy null-lineage return guard", () => {
  const database = createIdempotencyTestDatabase("p0c1-legacy-return-guard");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("blocks further merchandise returns when a legacy null-lineage child exists", async () => {
    const fixture = await seedClosedPaidOrderFixture(database.client, {
      quantity: 5,
      grandTotal: 10_000n,
    });
    const item = fixture.orderItems[0]!;

    const legacyRefund = await database.client.order.create({
      data: {
        orderNumber: "LEGACY-REF-1",
        orderType: "Refund",
        status: "Closed",
        cashierId: fixture.user.id,
        terminalId: fixture.terminalId,
        shiftId: fixture.shift.id,
        subTotal: -2_000n,
        grandTotal: -2_000n,
        originalOrderId: fixture.order.id,
        orderItems: {
          create: {
            productId: fixture.product.id,
            quantity: -1,
            unitPrice: 2_000n,
            lineTotal: -2_000n,
            status: "Closed",
            sourceOrderItemId: null,
            notes: "pre-migration return",
          },
        },
      },
    });
    expect(legacyRefund.id).toBeGreaterThan(0);

    await expect(
      runReturnIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        items: [{ orderItemId: item.id, returnQty: 1 }],
        refundAmount: 2_000n,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof ServiceError &&
        error.code === RETURN_HISTORY_RECONCILIATION_REQUIRED &&
        error.status === 409
      );
    });

    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    await expect(
      countStockMovements(database.client, fixture.product.id, "Return"),
    ).resolves.toBe(0);
    const source = await database.client.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(source.returnedQuantity).toBe(0);
  });
});
