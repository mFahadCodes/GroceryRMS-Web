import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const ORDER_SERVICE = "lib/services/order-service.ts";
const CONCURRENCY_LIB = "lib/security/order-financial-concurrency.ts";
const CHECKOUT_ROUTE = "app/api/orders/[id]/checkout/route.ts";
const PARTIAL_ROUTE = "app/api/orders/[id]/partial-payment/route.ts";
const IDEMPOTENCY_SERVICE = "lib/services/idempotency-service.ts";

describe("financial concurrency source regression", () => {
  it("defines CAS helpers for checkout and payable transitions", () => {
    const source = read(CONCURRENCY_LIB);
    expect(source).toContain("claimCheckoutCompletion");
    expect(source).toContain("claimOrderClosedFromPayable");
    expect(source).toContain("claimOrderPartiallyPaid");
    expect(source).toContain("acquirePayableOrderWrite");
    expect(source).toContain("assertPaymentWithinRemaining");
    expect(source).toContain("updateMany");
  });

  it("checkoutFast imports and uses claimCheckoutCompletion with Open predicate", () => {
    const source = read(ORDER_SERVICE);
    expect(source).toContain(
      'from "@/lib/security/order-financial-concurrency"',
    );
    expect(source).toContain("claimCheckoutCompletion");
    const checkoutStart = source.indexOf("export async function checkoutFast");
    const checkoutFn = source.slice(checkoutStart, checkoutStart + 8_000);
    expect(checkoutFn).toContain("claimCheckoutCompletion");
    expect(checkoutFn).toContain('status !== "Open"');
    const helper = read(CONCURRENCY_LIB);
    expect(helper).toMatch(/where:\s*\{\s*id:\s*orderId,\s*status:\s*"Open"/);
  });

  it("checkoutFast does not use unconditional order.update for status Closed", () => {
    const source = read(ORDER_SERVICE);
    const checkoutStart = source.indexOf("export async function checkoutFast");
    const nextExport = source.indexOf("export async function getShiftOrders");
    const checkoutFn = source.slice(checkoutStart, nextExport);
    expect(checkoutFn).not.toMatch(
      /order\.update\(\s*\{[^}]*status:\s*"Closed"/s,
    );
    expect(checkoutFn).toContain("claimCheckoutCompletion");
  });

  it("applyPartialPayment revalidates remaining before payment.create", () => {
    const source = read(ORDER_SERVICE);
    const start = source.indexOf("export async function applyPartialPayment");
    const end = source.indexOf("export async function", start + 1);
    const fn = source.slice(start, end === -1 ? undefined : end);
    expect(fn).toContain("acquirePayableOrderWrite");
    expect(fn).toContain("assertPaymentWithinRemaining");
    const remainingIdx = fn.indexOf("assertPaymentWithinRemaining");
    const createIdx = fn.indexOf("payment.create");
    expect(remainingIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(remainingIdx);
  });

  it("applyPartialPayment uses CAS for Closed and PartiallyPaid transitions", () => {
    const source = read(ORDER_SERVICE);
    const start = source.indexOf("export async function applyPartialPayment");
    const end = source.indexOf("export async function", start + 1);
    const fn = source.slice(start, end === -1 ? undefined : end);
    expect(fn).toContain("claimOrderClosedFromPayable");
    expect(fn).toContain("claimOrderPartiallyPaid");
    expect(fn).not.toMatch(/order\.update\(\s*\{[^}]*status:\s*"Closed"/s);
    expect(fn).not.toMatch(
      /order\.update\(\s*\{[^}]*status:\s*"PartiallyPaid"/s,
    );
  });

  it("processOrderCompletion is only reached after a successful close claim in partial path", () => {
    const source = read(ORDER_SERVICE);
    const start = source.indexOf("export async function applyPartialPayment");
    const end = source.indexOf("export async function", start + 1);
    const fn = source.slice(start, end === -1 ? undefined : end);
    const closeIdx = fn.indexOf("claimOrderClosedFromPayable");
    const completionIdx = fn.indexOf("processOrderCompletion");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(completionIdx).toBeGreaterThan(closeIdx);
  });

  it("routes map ServiceError status including 409 conflicts", () => {
    for (const file of [CHECKOUT_ROUTE, PARTIAL_ROUTE]) {
      const source = read(file);
      expect(source).toContain("ServiceError");
      expect(source).toMatch(
        /if\s*\(error\s+instanceof\s+ServiceError\)\s*\{[\s\S]*error\.status/,
      );
    }
  });

  it("does not introduce process-memory locks or Redis", () => {
    for (const file of [ORDER_SERVICE, CONCURRENCY_LIB, IDEMPOTENCY_SERVICE]) {
      const source = read(file);
      expect(source).not.toMatch(/\bMutex\b|\bAsyncLock\b|node-redis|ioredis/i);
      expect(source).not.toContain("globalThis.__orderLock");
    }
  });

  it("does not add a caller-controlled concurrency bypass flag", () => {
    const source = read(CONCURRENCY_LIB);
    expect(source).not.toMatch(/skipConcurrency|bypassLock|disableCas/i);
    const orderService = read(ORDER_SERVICE);
    expect(orderService).not.toMatch(/skipConcurrency|bypassLock|disableCas/i);
  });

  it("does not trust request-supplied paidAmount, remainingBalance, or status", () => {
    const partialRoute = read(PARTIAL_ROUTE);
    expect(partialRoute).not.toMatch(/parsed\.data\.(paidAmount|remaining|status)/);
    const checkoutRoute = read(CHECKOUT_ROUTE);
    expect(checkoutRoute).not.toMatch(
      /parsed\.data\.(paidAmount|remainingBalance|status)/,
    );
  });

  it("zero-row CAS maps to ServiceError conflict codes", () => {
    const source = read(CONCURRENCY_LIB);
    expect(source).toContain("claimed.count !== 1");
    expect(source).toContain("ORDER_NOT_OPEN");
    expect(source).toContain("ORDER_FINANCIAL_CONFLICT");
    expect(source).toContain("409");
  });

  it("idempotency completion remains inside the transaction before commit", () => {
    const source = read(IDEMPOTENCY_SERVICE);
    expect(source).toContain("$transaction");
    expect(source).toContain('state: "COMPLETED"');
    const txnStart = source.indexOf("return await client.$transaction");
    const txnBody = source.slice(txnStart, txnStart + 2_500);
    expect(txnBody).toContain('state: "COMPLETED"');
    expect(txnBody).toContain("input.execute(tx)");
  });

  it("Prisma schema has no new paidAmount or version column for P0-B", () => {
    const schema = read("prisma/schema.prisma");
    const orderModel = schema.slice(
      schema.indexOf("model Order {"),
      schema.indexOf("model OrderItem {"),
    );
    expect(orderModel).not.toContain("paidAmount");
    expect(orderModel).not.toContain("version");
  });
});
