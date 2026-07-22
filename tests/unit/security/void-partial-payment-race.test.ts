import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { applyPartialPayment } from "@/lib/services/order-service";
import {
  countAudits,
  countIdempotencyRecords,
  countPayments,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  resetIdempotencyTables,
} from "./idempotency-test-database";
import {
  issueVoidGrant,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void versus partial-payment races", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-partial");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function seedPayable(client: typeof database.client) {
    const fixture = await seedVoidableOrderFixture(client, {
      status: "Open",
      grandTotal: 10_000n,
    });
    await client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    const shift = await client.shift.create({
      data: {
        userId: fixture.requester.id,
        terminalId: fixture.requesterContext.terminalId!,
        openingBalance: 5_000n,
      },
    });
    await client.order.update({
      where: { id: fixture.order.id },
      data: { shiftId: shift.id },
    });
    return fixture;
  }

  it("void versus non-final partial: at most one incompatible terminal effect set commits", async () => {
    const fixture = await seedPayable(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 50);
    const results = await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
      }),
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        operation: "order.partial-payment",
        resourceType: "orders",
        resourceId: fixture.order.id,
        actorUserId: fixture.requester.id,
        authoritativeTerminalId: fixture.requesterContext.terminalId,
        requestPayload: {
          orderId: fixture.order.id,
          paymentMethodId: 1,
          amount: 4_000n,
        },
        client: database.client,
        execute: async (tx) => {
          const order = await applyPartialPayment(
            {
              orderId: fixture.order.id,
              paymentMethodId: 1,
              amount: 4_000n,
              userId: fixture.requester.id,
              auditIpAddress: "127.0.0.1",
            },
            tx,
          );
          return { status: 200, body: serializeRecord(order) };
        },
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });

    if (order.status === "Void") {
      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(0);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    } else {
      // Partial payment may leave Open or PartiallyPaid under current rules
      expect(["Open", "PartiallyPaid", "Closed"]).toContain(order.status);
      await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
    }
    await expect(countIdempotencyRecords(database.client)).resolves.toBeLessThanOrEqual(2);
  });

  it("after partial payment leaves PartiallyPaid, a later void can still succeed under current rules", async () => {
    const fixture = await seedPayable(database.client);
    await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 4_000n,
      },
      client: database.client,
      execute: async (tx) => {
        const order = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 4_000n,
            userId: fixture.requester.id,
            auditIpAddress: "127.0.0.1",
          },
          tx,
        );
        return { status: 200, body: serializeRecord(order) };
      },
    });
    const { token } = await issueVoidGrant(database.client, fixture, 51);
    await runVoidIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      token,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
  });
});
