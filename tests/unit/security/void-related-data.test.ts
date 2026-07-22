import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyTestDatabase,
} from "./idempotency-test-database";
import {
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void related-data invariants", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-related");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("voiding one order does not change another open order", async () => {
    const a = await seedVoidableOrderFixture(database.client, { orderId: 50 });
    await database.client.order.create({
      data: {
        id: 99,
        orderNumber: "ORD-99",
        orderType: "WalkIn",
        status: "Open",
        cashierId: a.requester.id,
        terminalId: a.requesterContext.terminalId,
        subTotal: 5_000n,
        grandTotal: 5_000n,
      },
    });
    const { token } = await issueVoidGrant(database.client, a, 100);
    await runVoidIdempotent(database.client, a, { token });
    const other = await database.client.order.findUniqueOrThrow({
      where: { id: 99 },
    });
    expect(other.status).toBe("Open");
  });

  it("void does not mutate unrelated product stock when reverseStock is false", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 40,
    });
    await database.client.product.create({
      data: {
        id: 99,
        name: "Other",
        categoryId: 1,
        basePrice: 100n,
        costPrice: 50n,
        currentStock: 7,
      },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 101);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reverseStock: false,
    });
    const other = await database.client.product.findUniqueOrThrow({
      where: { id: 99 },
    });
    expect(Number(other.currentStock)).toBe(7);
  });

  it("void does not create loyalty transactions", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 102);
    await runVoidIdempotent(database.client, fixture, { token });
    await expect(database.client.loyaltyTransaction.count()).resolves.toBe(0);
  });

  it("void does not alter user authVersion or session rows", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const beforeUser = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.requester.id },
    });
    const beforeSession = await database.client.userSession.findUniqueOrThrow({
      where: { id: fixture.session.id },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 103);
    await runVoidIdempotent(database.client, fixture, { token });
    const afterUser = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.requester.id },
    });
    const afterSession = await database.client.userSession.findUniqueOrThrow({
      where: { id: fixture.session.id },
    });
    expect(afterUser.authVersion).toBe(beforeUser.authVersion);
    expect(afterSession.sessionId).toBe(beforeSession.sessionId);
  });

  it("P0-C1 returnedQuantity remains zero when voiding without returns", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 104);
    await runVoidIdempotent(database.client, fixture, { token });
    const items = await database.client.orderItem.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(items.every((item) => item.returnedQuantity === 0)).toBe(true);
    expect(items.every((item) => item.sourceOrderItemId === null)).toBe(true);
  });
});
