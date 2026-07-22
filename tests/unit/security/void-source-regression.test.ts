import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";
import { MANAGER_APPROVAL_ACTIONS } from "@/lib/security/manager-approval";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const VOID_ROUTE = "app/api/orders/[id]/void/route.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const VOID_CONCURRENCY = "lib/security/void-concurrency.ts";
const IDEMPOTENCY_LIB = "lib/security/idempotency.ts";
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
  });

  it("conditional void claim uses updateMany with status not Void", () => {
    const source = read(VOID_CONCURRENCY);
    expect(source).toContain("updateMany");
    expect(source).toContain('status: { not: "Void" }');
    expect(source).toContain("ORDER_NOT_VOIDABLE");
    expect(source).toContain("ORDER_VOID_CONFLICT");
  });

  it("void route has no optional no-key fallback and no managerPin", () => {
    const source = read(VOID_ROUTE);
    expect(source).not.toContain("IDEMPOTENCY_KEY_MISSING");
    expect(source).not.toMatch(/keyParsed\.ok\s*\?\s*/);
    expect(source).not.toContain("managerPin");
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

  it("preserves prior financial operations unchanged", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toEqual([
      "order.checkout",
      "order.partial-payment",
      "order.refund",
      "order.return",
      "order.void",
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
    ];
    for (const file of files) {
      const source = read(file);
      expect(source.includes("prisma/dev.db")).toBe(false);
      expect(source.includes('"dev.db"')).toBe(false);
    }
  });
});
