import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const REFUND_ROUTE = "app/api/orders/[id]/refund/route.ts";
const RETURN_ROUTE = "app/api/orders/[id]/return/route.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const CONCURRENCY = "lib/security/refund-return-concurrency.ts";
const IDEMPOTENCY_LIB = "lib/security/idempotency.ts";
const SCHEMA = "prisma/schema.prisma";

describe("refund/return source regression", () => {
  it("refund and return routes require Idempotency-Key parsing", () => {
    for (const file of [REFUND_ROUTE, RETURN_ROUTE]) {
      const source = read(file);
      expect(source).toContain("parseIdempotencyKey");
      expect(source).toContain('request.headers.get("idempotency-key")');
      expect(source).toMatch(/if\s*\(!keyParsed\.ok\)\s*\{\s*return fail\(/);
    }
  });

  it("registers order.refund and order.return operations", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain("order.refund");
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain("order.return");
    const source = read(IDEMPOTENCY_LIB);
    expect(source).toContain('"order.refund"');
    expect(source).toContain('"order.return"');
  });

  it("refund and return routes call executeFinancialIdempotent with the transaction client", () => {
    const refund = read(REFUND_ROUTE);
    expect(refund).toContain('operation: "order.refund"');
    expect(refund).toMatch(/refundOrder\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/);
    const ret = read(RETURN_ROUTE);
    expect(ret).toContain('operation: "order.return"');
    expect(ret).toMatch(/returnOrderItems\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/);
  });

  it("uses returnedQuantity CAS helper and not product-level aggregation authority", () => {
    const source = read(CONCURRENCY);
    expect(source).toContain("claimSourceReturnQuantities");
    expect(source).toContain("returnedQuantity");
    expect(source).toContain("updateMany");
    expect(source).not.toMatch(/groupBy.*productId|product-level/i);
  });

  it("refundOrder and returnOrderItems accept an outer transaction client", () => {
    const source = read(ORDER_SERVICE);
    expect(source).toMatch(
      /export async function refundOrder\([\s\S]*txClient\?:\s*Prisma\.TransactionClient/,
    );
    expect(source).toMatch(
      /export async function returnOrderItems\([\s\S]*txClient\?:\s*Prisma\.TransactionClient/,
    );
  });

  it("claims quantities and sets sourceOrderItemId before/with child merchandise lines", () => {
    const source = read(ORDER_SERVICE);
    const refundStart = source.indexOf("export async function refundOrder");
    const refundFn = source.slice(
      refundStart,
      source.indexOf("export async function updateItemQuantity"),
    );
    expect(refundFn).toContain("claimSourceReturnQuantities");
    expect(refundFn).toContain("sourceOrderItemId");
    expect(refundFn).toContain("assertNoLegacyNullLineageReturns");
    expect(refundFn).toContain("sumCommittedRefundAbsolute");

    const returnStart = source.indexOf("export async function returnOrderItems");
    const returnFn = source.slice(
      returnStart,
      source.indexOf("async function getAppSettingInt"),
    );
    expect(returnFn).toContain("claimSourceReturnQuantities");
    expect(returnFn).toContain("sourceOrderItemId");
    expect(returnFn).toContain("assertNoLegacyNullLineageReturns");
  });

  it("schema defines returnedQuantity default 0 and nullable sourceOrderItemId with SetNull", () => {
    const schema = read(SCHEMA);
    const model = schema.slice(
      schema.indexOf("model OrderItem {"),
      schema.indexOf("model Payment {"),
    );
    expect(model).toContain('returnedQuantity  Int  @default(0) @map("returned_quantity")');
    expect(model).toContain('sourceOrderItemId Int? @map("source_order_item_id")');
    expect(model).toContain("onDelete: SetNull");
    expect(model).toContain("@@index([sourceOrderItemId])");
  });

  it("routes have no optional no-key fallback", () => {
    for (const file of [REFUND_ROUTE, RETURN_ROUTE]) {
      const source = read(file);
      expect(source).not.toMatch(/keyParsed\.ok\s*\?\s*|optional.*[Ii]dempotency/);
      expect(source).not.toContain("IDEMPOTENCY_KEY_MISSING");
      // Missing key returns fail via !keyParsed.ok — ensure early return exists
      expect(source).toContain("keyParsed.ok");
    }
  });

  it("does not introduce process-memory locks or Redis", () => {
    for (const file of [ORDER_SERVICE, CONCURRENCY]) {
      const source = read(file);
      expect(source).not.toMatch(/\bMutex\b|ioredis|node-redis/i);
    }
  });

  it("migration and P0-C1 tests never access prisma/dev.db", () => {
    const migration = read(
      "prisma/migrations/20260725_000000_add_order_item_return_quantity/migration.sql",
    );
    expect(migration.includes("dev.db")).toBe(false);
    const testFiles = [
      "tests/unit/security/refund-return-migration.test.ts",
      "tests/unit/security/refund-return-test-harness.ts",
      "tests/unit/security/refund-idempotency.test.ts",
      "tests/unit/security/return-idempotency.test.ts",
      "tests/unit/security/refund-concurrency.test.ts",
      "tests/unit/security/return-quantity-concurrency.test.ts",
      "tests/unit/security/refund-return-cross-operation.test.ts",
      "tests/unit/security/refund-return-rollback.test.ts",
      "tests/unit/security/refund-return-legacy-guard.test.ts",
      "tests/unit/security/refund-return-canonicalization.test.ts",
      "tests/unit/security/refund-return-financial-invariants.test.ts",
      "tests/unit/security/refund-return-stock-invariants.test.ts",
      "tests/unit/security/refund-return-manager-approval.test.ts",
    ];
    for (const file of testFiles) {
      const source = read(file);
      expect(source.includes("prisma/dev.db")).toBe(false);
      expect(source.includes("prisma\\dev.db")).toBe(false);
      expect(source.includes("'dev.db'")).toBe(false);
      expect(source.includes('"dev.db"')).toBe(false);
    }
  });

  it("does not use sourceOrderItemId aggregation as the concurrency authority", () => {
    const source = read(CONCURRENCY);
    expect(source).toContain("returnedQuantity");
    expect(source.includes("groupBy(")).toBe(false);
    expect(source.includes(".aggregate(")).toBe(false);
    const claim = source.slice(source.indexOf("claimSourceReturnQuantities"));
    expect(claim).toContain("updateMany");
    expect(claim).toMatch(/returnedQuantity:\s*item\.returnedQuantity/);
    expect(claim).toMatch(/returnedQuantity:\s*proposed/);
  });
});
