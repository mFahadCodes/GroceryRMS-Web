import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_NOT_DISCOUNTABLE } from "@/lib/security/discount-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";

describe("discount versus closed refund/return parents", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-refund-return");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("Closed refund/return parent remains unchanged by discount", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client, {
      status: "Closed",
      discountAmount: 0n,
      grandTotal: 10_000n,
    });
    await database.client.orderItem.updateMany({
      where: { orderId: fixture.order.id },
      data: { returnedQuantity: 1 },
    });
    const before = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 70);
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 250n,
      }),
    ).rejects.toMatchObject({ code: ORDER_NOT_DISCOUNTABLE, status: 409 });

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    expect(order.discountAmount).toBe(0n);
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(item.returnedQuantity).toBe(before.returnedQuantity);
    expect(item.sourceOrderItemId ?? null).toBe(before.sourceOrderItemId ?? null);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });
});
