import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { ServiceError } from "@/lib/api/service-error";
import { ORDER_NOT_MUTABLE } from "@/lib/security/order-mutable-concurrency";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  addItemToOrder,
  checkoutFast,
  removeOrderItem,
  updateItemQuantity,
} from "@/lib/services/order-service";
import { IDEMPOTENCY_TEST_KEY } from "./idempotency-test-database";
import {
  countAudits,
  createIdempotencyTestDatabase,
  resetMutableOrderTables,
  runOnMutableClient,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";

const FAIL_AUDIT = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;

describe("order item integrity", () => {
  const database = createIdempotencyTestDatabase("p0f-item-integrity");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("Open order: item add succeeds, totals recalculated, audit in transaction", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const secondProduct = await database.client.product.create({
      data: {
        id: 11,
        name: "Second Product",
        categoryId: 1,
        basePrice: 2_000n,
        costPrice: 200n,
        currentStock: 10,
      },
    });
    const updated = await runOnMutableClient(database.client, (tx) =>
      addItemToOrder(
        {
          orderId: fixture.order.id,
          productId: secondProduct.id,
          quantity: 1,
          userId: fixture.user.id,
        },
        tx,
      ),
    );
    expect(updated.orderItems.length).toBe(2);
    expect(updated.subTotal).toBe(fixture.lineTotal + 2_000n);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(1);
  });

  it("Open order: item quantity update succeeds", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const itemId = fixture.order.orderItems[0]!.id;
    const updated = await runOnMutableClient(database.client, (tx) =>
      updateItemQuantity(
        {
          orderId: fixture.order.id,
          orderItemId: itemId,
          quantity: 3,
          userId: fixture.user.id,
        },
        tx,
      ),
    );
    expect(updated.subTotal).toBe(fixture.unitPrice * 3n);
    await expect(
      countAudits(database.client, "PATCH_ORDER_ITEM"),
    ).resolves.toBe(1);
  });

  it("Open order: item remove succeeds", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const itemId = fixture.order.orderItems[0]!.id;
    const updated = await runOnMutableClient(database.client, (tx) =>
      removeOrderItem(
        {
          orderId: fixture.order.id,
          orderItemId: itemId,
          voidReason: "customer changed mind",
          userId: fixture.user.id,
        },
        tx,
      ),
    );
    expect(updated.orderItems).toHaveLength(0);
    expect(updated.subTotal).toBe(0n);
    await expect(
      countAudits(database.client, "DELETE_ORDER_ITEM"),
    ).resolves.toBe(1);
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
    "Delivered",
    "Closed",
    "Void",
  ] as const)("non-Open %s rejects add/update/remove", async (status) => {
    const fixture = await seedMutableOrderFixture(database.client, { status });
    const itemId = fixture.order.orderItems[0]!.id;
    const product = await database.client.product.create({
      data: {
        id: 12,
        name: `Extra ${status}`,
        categoryId: 1,
        basePrice: 1_000n,
        costPrice: 100n,
        currentStock: 5,
      },
    });

    await expect(
      runOnMutableClient(database.client, (tx) =>
        addItemToOrder(
          {
            orderId: fixture.order.id,
            productId: product.id,
            quantity: 1,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);

    await expect(
      runOnMutableClient(database.client, (tx) =>
        updateItemQuantity(
          {
            orderId: fixture.order.id,
            orderItemId: itemId,
            quantity: 9,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);

    await expect(
      runOnMutableClient(database.client, (tx) =>
        removeOrderItem(
          {
            orderId: fixture.order.id,
            orderItemId: itemId,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
  });

  it("when checkout wins first, item add is rejected with ORDER_NOT_MUTABLE", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const product = await database.client.product.create({
      data: {
        id: 13,
        name: "Race Product",
        categoryId: 1,
        basePrice: 1_000n,
        costPrice: 100n,
        currentStock: 5,
      },
    });

    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: fixture.lineTotal,
        terminalId: fixture.terminalId,
        discountPercent: 0,
        taxPercent: 0,
        customerId: null,
        notes: null,
        referenceNo: null,
        redeemPoints: 0n,
        payments: null,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            tenderedAmount: fixture.lineTotal,
            terminalId: fixture.terminalId,
            cashierId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });

    await expect(
      runOnMutableClient(database.client, (tx) =>
        addItemToOrder(
          {
            orderId: fixture.order.id,
            productId: product.id,
            quantity: 1,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(0);
  });

  it("item operations on items belonging to a different order are rejected", async () => {
    const fixtureA = await seedMutableOrderFixture(database.client, {
      orderId: 80,
    });
    const foreignOrder = await database.client.order.create({
      data: {
        id: 81,
        orderNumber: "ORD-81",
        orderType: "WalkIn",
        status: "Open",
        cashierId: fixtureA.user.id,
        terminalId: fixtureA.terminalId,
        subTotal: fixtureA.unitPrice,
        grandTotal: fixtureA.unitPrice,
        orderItems: {
          create: {
            productId: fixtureA.product.id,
            quantity: 1,
            unitPrice: fixtureA.unitPrice,
            lineTotal: fixtureA.unitPrice,
            status: "Open",
          },
        },
      },
      include: { orderItems: true },
    });
    const foreignItemId = foreignOrder.orderItems[0]!.id;

    await expect(
      runOnMutableClient(database.client, (tx) =>
        updateItemQuantity(
          {
            orderId: fixtureA.order.id,
            orderItemId: foreignItemId,
            quantity: 5,
            userId: fixtureA.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "ORDER_ITEM_MISMATCH",
      status: 409,
    } satisfies Partial<ServiceError>);

    await expect(
      runOnMutableClient(database.client, (tx) =>
        removeOrderItem(
          {
            orderId: fixtureA.order.id,
            orderItemId: foreignItemId,
            userId: fixtureA.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "ORDER_ITEM_MISMATCH",
      status: 409,
    } satisfies Partial<ServiceError>);
  });

  it("rollback: failed mid-transaction leaves no item change", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    const product = await database.client.product.create({
      data: {
        id: 14,
        name: "Rollback Product",
        categoryId: 1,
        basePrice: 1_500n,
        costPrice: 150n,
        currentStock: 5,
      },
    });
    await database.client.$executeRawUnsafe(FAIL_AUDIT);

    await expect(
      runOnMutableClient(database.client, (tx) =>
        addItemToOrder(
          {
            orderId: fixture.order.id,
            productId: product.id,
            quantity: 1,
            userId: fixture.user.id,
          },
          tx,
        ),
      ),
    ).rejects.toBeTruthy();

    const items = await database.client.orderItem.findMany({
      where: { orderId: fixture.order.id, status: { not: "Void" } },
    });
    expect(items).toHaveLength(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.subTotal).toBe(fixture.lineTotal);
    await expect(countAudits(database.client, "ADD_ORDER_ITEM")).resolves.toBe(0);
  });
});
