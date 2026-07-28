import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";
import { MANAGER_APPROVAL_ACTIONS } from "@/lib/security/manager-approval";
import { VOIDABLE_ORDER_STATUSES } from "@/lib/security/void-concurrency";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const VOID_ROUTE = "app/api/orders/[id]/void/route.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const VOID_CONCURRENCY = "lib/security/void-concurrency.ts";
const IDEMPOTENCY_LIB = "lib/security/idempotency.ts";
const VALIDATORS = "lib/validators/order.validators.ts";
const SCHEMA = "prisma/schema.prisma";

describe("void source regression", () => {
  it("void route requires Idempotency-Key parsing and fails closed", () => {
    const source = read(VOID_ROUTE);
    expect(source).toContain("parseIdempotencyKey");
    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toMatch(/if\s*\(!keyParsed\.ok\)\s*\{\s*return fail\(/);
  });

  it("registers order.void in the financial idempotency map", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain("order.void");
    expect(read(IDEMPOTENCY_LIB)).toContain('"order.void"');
  });

  it("void route uses executeFinancialIdempotent with order.void and transaction client", () => {
    const source = read(VOID_ROUTE);
    expect(source).toContain('operation: "order.void"');
    expect(source).toMatch(/voidOrder\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/);
    expect(source).toContain("IdempotencyConflictError");
  });

  it("requestPayload excludes managerApprovalToken", () => {
    const source = read(VOID_ROUTE);
    const payloadStart = source.indexOf("const requestPayload");
    const payloadEnd = source.indexOf("};", payloadStart);
    const block = source.slice(payloadStart, payloadEnd);
    expect(block).toContain("reason");
    expect(block).toContain("reverseStock");
    expect(block).not.toContain("managerApprovalToken");
    expect(block).not.toContain("approvalToken");
  });

  it("validates business payload before execute and token only inside execute", () => {
    const source = read(VOID_ROUTE);
    const businessIndex = source.indexOf("voidOrderBusinessSchema");
    const executeIndex = source.indexOf("execute: async (tx)");
    const tokenIndex = source.indexOf("voidManagerApprovalTokenSchema.safeParse");
    expect(businessIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(businessIndex);
    expect(tokenIndex).toBeGreaterThan(executeIndex);
  });

  it("replay path is before execute which consumes approval", () => {
    const service = read("lib/services/idempotency-service.ts");
    const replayIndex = service.indexOf("loadCompletedReplay");
    const executeIndex = service.indexOf("input.execute(tx)");
    expect(replayIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(replayIndex);
  });

  it("voidOrder accepts an outer transaction client and uses claimVoidTransition", () => {
    const source = read(ORDER_SERVICE);
    expect(source).toMatch(
      /export async function voidOrder\([\s\S]*txClient\?:\s*Prisma\.TransactionClient/,
    );
    expect(source).toContain("claimVoidTransition");
    expect(source).toContain("consumeManagerApprovalGrant");
    expect(source).toContain("assertOrderVoidable");
  });

  it("conditional void claim uses the exact Open-only allowlist", () => {
    const source = read(VOID_CONCURRENCY);
    expect(source).toContain("updateMany");
    expect(source).toContain("VOIDABLE_ORDER_STATUSES");
    expect(source).toContain('status: { in: [...VOIDABLE_ORDER_STATUSES] }');
    expect(source).not.toContain('status: { not: "Void" }');
    expect(source).not.toContain("PartiallyPaid");
    expect(source).not.toContain("Closed");
    expect(source).not.toContain("Packed");
    expect(source).not.toContain("OutForDelivery");
    expect(source).not.toContain("Delivered");
    expect([...VOIDABLE_ORDER_STATUSES]).toEqual(["Open"]);
    expect(VOIDABLE_ORDER_STATUSES).toHaveLength(1);
    expect(source).toContain("ORDER_NOT_VOIDABLE");
    expect(source).toContain("ORDER_VOID_CONFLICT");
    expect(source).toContain("claimed.count === 1");
  });

  it("voidOrder claims before consuming manager approval", () => {
    const source = read(ORDER_SERVICE);
    const start = source.indexOf("export async function voidOrder");
    const end = source.indexOf("export async function holdOrder");
    const fn = source.slice(start, end);
    const claimIndex = fn.indexOf("claimVoidTransition");
    const consumeIndex = fn.indexOf("consumeManagerApprovalGrant");
    expect(claimIndex).toBeGreaterThan(-1);
    expect(consumeIndex).toBeGreaterThan(claimIndex);
  });

  it("void route has no optional no-key fallback and no managerPin", () => {
    const source = read(VOID_ROUTE);
    expect(source).not.toContain("IDEMPOTENCY_KEY_MISSING");
    expect(source).not.toMatch(/keyParsed\.ok\s*\?\s*/);
    expect(source).not.toContain("managerPin");
  });

  it("validators keep token out of business schema and forbid PIN fallback", () => {
    const source = read(VALIDATORS);
    const business = source.slice(
      source.indexOf("export const voidOrderBusinessSchema"),
      source.indexOf("export const voidManagerApprovalTokenSchema"),
    );
    expect(business).toContain("reason");
    expect(business).toContain("reverseStock");
    expect(business).not.toContain("managerApprovalToken");
    expect(business).not.toContain("managerPin");
    expect(source).not.toMatch(
      /voidOrderSchema[\s\S]{0,400}managerPin/,
    );
  });

  it("does not introduce nested prisma.$transaction inside voidOrder when txClient is provided", () => {
    const source = read(ORDER_SERVICE);
    const start = source.indexOf("export async function voidOrder");
    const end = source.indexOf("export async function holdOrder");
    const fn = source.slice(start, end);
    expect(fn).toContain("if (txClient) return run(txClient)");
    expect(fn).toContain("prisma.$transaction(run)");
    expect(fn).not.toMatch(/prisma\.\$transaction\([\s\S]*prisma\.\$transaction/);
  });

  it("does not use process-memory locks or Redis", () => {
    for (const file of [ORDER_SERVICE, VOID_CONCURRENCY, VOID_ROUTE]) {
      const source = read(file);
      expect(source).not.toMatch(/\bMutex\b|ioredis|node-redis/i);
    }
  });

  it("does not add a Prisma schema migration for P0-C2", () => {
    const schema = read(SCHEMA);
    expect(schema).not.toContain("voidVersion");
    expect(schema).not.toContain("void_claimed_at");
  });

  it("manager approval action for void remains order.void", () => {
    expect(MANAGER_APPROVAL_ACTIONS).toContain("order.void");
  });

  it("preserves prior financial operations and registers order.discount", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toEqual([
      "order.checkout",
      "order.partial-payment",
      "order.refund",
      "order.return",
      "order.void",
      "order.discount",
      "order.apply-tax",
      "order.apply-adjustment",
      "order.add-item",
      "order.update-item-quantity",
      "inventory.stock-take-apply",
    ]);
  });

  it("P0-C2 tests and helpers never access prisma/dev.db", () => {
    const files = [
      "tests/unit/security/void-test-harness.ts",
      "tests/unit/security/void-idempotency.test.ts",
      "tests/unit/security/void-canonicalization.test.ts",
      "tests/unit/security/void-different-key-concurrency.test.ts",
      "tests/unit/security/void-checkout-race.test.ts",
      "tests/unit/security/void-partial-payment-race.test.ts",
      "tests/unit/security/void-refund-return-race.test.ts",
      "tests/unit/security/void-rollback.test.ts",
      "tests/unit/security/void-manager-approval-replay.test.ts",
      "tests/unit/security/void-stock-financial-invariants.test.ts",
      "tests/unit/security/void-related-data.test.ts",
      "tests/unit/security/void-eligibility.test.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source.includes("prisma/dev.db")).toBe(false);
      expect(source.includes('"dev.db"')).toBe(false);
    }
  });
});
