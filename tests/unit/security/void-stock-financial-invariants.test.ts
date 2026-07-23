import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countStockMovements,
  createIdempotencyTestDatabase,
} from "./idempotency-test-database";
import {
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void stock and financial invariants", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-stock");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("without reverseStock leaves product stock unchanged", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 15,
      quantity: 3,
    });
    const { token } = await issueVoidGrant(database.client, fixture, 90);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reverseStock: false,
    });
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product!.id },
    });
    expect(Number(product.currentStock)).toBe(15);
    await expect(
      countStockMovements(database.client, fixture.product!.id, "Return"),
    ).resolves.toBe(0);
  });

  it("with reverseStock increments stock by sold quantity and writes Return movement", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 15,
      quantity: 3,
    });
    const { token } = await issueVoidGrant(database.client, fixture, 91);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reverseStock: true,
    });
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product!.id },
    });
    expect(Number(product.currentStock)).toBe(18);
    await expect(
      countStockMovements(database.client, fixture.product!.id, "Return"),
    ).resolves.toBe(1);
  });

  it("voids all non-void order items and sets voidReason", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 92);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reason: "spoiled",
    });
    const items = await database.client.orderItem.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.status === "Void")).toBe(true);
    expect(items.every((item) => item.voidReason === "spoiled")).toBe(true);
  });

  it("does not create cash drawer or payment rows on void", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 93);
    await runVoidIdempotent(database.client, fixture, { token });
    await expect(database.client.payment.count()).resolves.toBe(0);
    await expect(database.client.cashDrawerLog.count()).resolves.toBe(0);
  });

  it("audit metadata summarizes reason without storing free text", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 94);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reason: "secret customer complaint text",
    });
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "VOID_ORDER" },
    });
    const values = JSON.stringify(audit.newValues ?? {});
    expect(values).not.toContain("secret customer complaint text");
    expect(values).toContain("reasonProvided");
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("skips already-void line items for stock reverse", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 10,
      quantity: 2,
    });
    const item = await database.client.orderItem.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    await database.client.orderItem.update({
      where: { id: item.id },
      data: { status: "Void", voidReason: "prior" },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 95);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reverseStock: true,
    });
    const product = await database.client.product.findUniqueOrThrow({
      where: { id: fixture.product!.id },
    });
    expect(Number(product.currentStock)).toBe(10);
    await expect(
      countStockMovements(database.client, fixture.product!.id, "Return"),
    ).resolves.toBe(0);
  });

  it("preserves grandTotal and payment amounts unchanged on void", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      grandTotal: 12_500n,
    });
    const { token } = await issueVoidGrant(database.client, fixture, 96);
    await runVoidIdempotent(database.client, fixture, { token });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.grandTotal).toBe(12_500n);
    expect(order.subTotal).toBe(12_500n);
  });
});
