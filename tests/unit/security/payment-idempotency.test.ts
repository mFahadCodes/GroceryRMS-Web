import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeRecord } from "@/lib/api/serialize";
import { checkoutFast } from "@/lib/services/order-service";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  countPayments,
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  resetIdempotencyTables,
  seedCheckoutOrderFixture,
} from "./idempotency-test-database";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

/**
 * P0-A note: full payment for an order is only ever created as a side effect
 * of checkout (`order.checkout`). There is no standalone "create a full
 * payment" route — `applyPartialPayment` covers the partial/split path and
 * itself upgrades to Paid only once the order is fully covered. These tests
 * assert that source-level invariant stays true and exercise the one real
 * code path that creates a Paid payment.
 */
describe("full payment is only reachable via checkout (source regression)", () => {
  const ordersApiDir = path.resolve("app/api/orders");

  function listRouteFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(listRouteFiles(full));
      } else if (entry.name === "route.ts") {
        files.push(full);
      }
    }
    return files;
  }

  it("has a checkout route registered under app/api/orders", () => {
    const files = listRouteFiles(ordersApiDir);
    expect(files.some((f) => f.replace(/\\/g, "/").endsWith("checkout/route.ts"))).toBe(
      true,
    );
  });

  it("has no route path literally named 'payment' or 'payments' under app/api/orders", () => {
    const files = listRouteFiles(ordersApiDir);
    const suspicious = files.filter((f) => {
      const normalized = f.replace(/\\/g, "/");
      return /\/(payment|payments)\/route\.ts$/.test(normalized);
    });
    expect(suspicious).toEqual([]);
  });

  it("only partial-payment and checkout create Payment rows for an order (grep across order routes)", () => {
    const files = listRouteFiles(ordersApiDir);
    const withPaymentCreate = files.filter((f) => {
      const source = read(f);
      return /payment\.create|applyPartialPayment|checkoutFast/.test(source);
    });
    const normalized = withPaymentCreate.map((f) => f.replace(/\\/g, "/"));
    for (const file of normalized) {
      expect(file).toMatch(/\/(checkout|partial-payment|refund|return)\/route\.ts$/);
    }
  });

  it("checkout route calls checkoutFast exactly once and does not call applyPartialPayment", () => {
    const source = read(path.resolve("app/api/orders/[id]/checkout/route.ts"));
    const matches = source.match(/checkoutFast\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).not.toContain("applyPartialPayment");
  });

  it("partial-payment route calls applyPartialPayment exactly once and does not call checkoutFast", () => {
    const source = read(path.resolve("app/api/orders/[id]/partial-payment/route.ts"));
    const matches = source.match(/applyPartialPayment\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).not.toContain("checkoutFast");
  });
});

describe("full payment integration via checkout", () => {
  const database = createIdempotencyTestDatabase("p0a-payment");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("checkout is the only path that creates a Paid payment, and it does so exactly once", async () => {
    const fixture = await seedCheckoutOrderFixture(database.client);

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
        tenderedAmount: fixture.grandTotal,
        terminalId: fixture.terminalId,
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

    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    const payment = await database.client.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    expect(payment.status).toBe("Paid");
    expect(payment.amount).toBe(fixture.grandTotal);
    expect(payment.tenderedAmount).toBe(fixture.grandTotal);
    expect(payment.changeAmount).toBe(0n);
  });
});
