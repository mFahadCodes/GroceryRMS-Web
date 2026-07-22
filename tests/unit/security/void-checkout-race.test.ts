import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
} from "./idempotency-test-database";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { checkoutFast } from "@/lib/services/order-service";
import {
  issueVoidGrant,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void versus checkout races", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-checkout");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("when void wins, checkout cannot complete payment or sale stock", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 20,
      quantity: 2,
    });
    await database.client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const shift = await database.client.shift.create({
      data: {
        userId: fixture.requester.id,
        terminalId: fixture.requesterContext.terminalId!,
        openingBalance: 10_000n,
      },
    });
    await database.client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: shift.id },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 40);

    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
      }),
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        operation: "order.checkout",
        resourceType: "orders",
        resourceId: fixture.order.id,
        actorUserId: fixture.requester.id,
        authoritativeTerminalId: fixture.requesterContext.terminalId,
        requestPayload: {
          orderId: fixture.order.id,
          paymentMethodId: 1,
          tenderedAmount: 10_000n,
        },
        client: database.client,
        execute: async (tx) => {
          const order = await checkoutFast(
            {
              orderId: fixture.order.id,
              paymentMethodId: 1,
              tenderedAmount: 10_000n,
              terminalId: fixture.requesterContext.terminalId!,
              cashierId: fixture.requester.id,
            },
            tx,
          );
          return { status: 200, body: serializeRecord(order) };
        },
      }),
    ]);

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const voidWins = order.status === "Void";
    const checkoutWins = order.status === "Closed";
    expect(voidWins || checkoutWins).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    if (voidWins) {
      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(0);
      await expect(
        countStockMovements(database.client, fixture.product!.id, "Sale"),
      ).resolves.toBe(0);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
      await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(0);
    } else {
      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
      await expect(countAudits(database.client, "CHECKOUT")).resolves.toBe(1);
    }
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("checkout fixture alone can still checkout when no void races", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);
    const result = await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.checkout",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        tenderedAmount: fixture.grandTotal,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await checkoutFast(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            tenderedAmount: fixture.grandTotal,
            terminalId: fixture.terminalId!,
            cashierId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });
    expect(result.replayed).toBe(false);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
  });
});
