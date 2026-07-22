import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const CHECKOUT_ROUTE = "app/api/orders/[id]/checkout/route.ts";
const PARTIAL_PAYMENT_ROUTE = "app/api/orders/[id]/partial-payment/route.ts";
const IDEMPOTENCY_LIB = "lib/security/idempotency.ts";
const IDEMPOTENCY_SERVICE = "lib/services/idempotency-service.ts";
const AUDIT_METADATA = "lib/security/audit-metadata.ts";

describe("idempotency source regression: route wiring", () => {
  it("checkout route reads the Idempotency-Key header and parses it with parseIdempotencyKey", () => {
    const source = read(CHECKOUT_ROUTE);
    expect(source).toContain(
      'import { parseIdempotencyKey } from "@/lib/security/idempotency"',
    );
    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toMatch(/parseIdempotencyKey\(\s*request\.headers\.get/);
  });

  it("partial-payment route reads the Idempotency-Key header and parses it with parseIdempotencyKey", () => {
    const source = read(PARTIAL_PAYMENT_ROUTE);
    expect(source).toContain(
      'import { parseIdempotencyKey } from "@/lib/security/idempotency"',
    );
    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toMatch(/parseIdempotencyKey\(\s*request\.headers\.get/);
  });

  it("checkout route fails closed (returns early) when the key does not parse — no fallback path", () => {
    const source = read(CHECKOUT_ROUTE);
    expect(source).toMatch(/if\s*\(!keyParsed\.ok\)\s*\{\s*return fail\(/);
  });

  it("partial-payment route fails closed (returns early) when the key does not parse — no fallback path", () => {
    const source = read(PARTIAL_PAYMENT_ROUTE);
    expect(source).toMatch(/if\s*\(!keyParsed\.ok\)\s*\{\s*return fail\(/);
  });

  it("checkout route runs the mutation through executeFinancialIdempotent with operation order.checkout", () => {
    const source = read(CHECKOUT_ROUTE);
    expect(source).toContain("executeFinancialIdempotent");
    expect(source).toContain("IdempotencyConflictError");
    expect(source).toContain('from "@/lib/services/idempotency-service"');
    expect(source).toMatch(/executeFinancialIdempotent\(\{/);
    expect(source).toContain('operation: "order.checkout"');
  });

  it("partial-payment route runs the mutation through executeFinancialIdempotent with operation order.partial-payment", () => {
    const source = read(PARTIAL_PAYMENT_ROUTE);
    expect(source).toMatch(/executeFinancialIdempotent\(\{/);
    expect(source).toContain('operation: "order.partial-payment"');
  });

  it("checkout route calls checkoutFast exactly once, inside the execute callback, with the transaction client", () => {
    const source = read(CHECKOUT_ROUTE);
    const calls = source.match(/checkoutFast\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source).toMatch(/checkoutFast\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/);
  });

  it("partial-payment route calls applyPartialPayment exactly once, inside the execute callback, with the transaction client", () => {
    const source = read(PARTIAL_PAYMENT_ROUTE);
    const calls = source.match(/applyPartialPayment\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source).toMatch(/applyPartialPayment\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/);
  });

  it("checkout route's single checkoutFast call is nested inside the executeFinancialIdempotent execute callback", () => {
    const source = read(CHECKOUT_ROUTE);
    const executeIndex = source.indexOf("execute: async (tx) => {");
    const checkoutFastIndex = source.indexOf("checkoutFast(");
    const conflictCatchIndex = source.indexOf("catch (error)");
    expect(executeIndex).toBeGreaterThan(-1);
    expect(checkoutFastIndex).toBeGreaterThan(executeIndex);
    expect(checkoutFastIndex).toBeLessThan(conflictCatchIndex);
  });

  it("partial-payment route's single applyPartialPayment call is nested inside the executeFinancialIdempotent execute callback", () => {
    const source = read(PARTIAL_PAYMENT_ROUTE);
    const executeIndex = source.indexOf("execute: async (tx) => {");
    const applyIndex = source.indexOf("applyPartialPayment(");
    const conflictCatchIndex = source.indexOf("catch (error)");
    expect(executeIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(executeIndex);
    expect(applyIndex).toBeLessThan(conflictCatchIndex);
  });

  it("neither route uses writeBestEffortAudit or auditFromRequest for the financial mutation", () => {
    for (const file of [CHECKOUT_ROUTE, PARTIAL_PAYMENT_ROUTE]) {
      const source = read(file);
      expect(source, file).not.toContain("writeBestEffortAudit");
      expect(source, file).not.toContain("auditFromRequest");
    }
  });

  it("both routes surface IdempotencyConflictError as an HTTP 409", () => {
    for (const file of [CHECKOUT_ROUTE, PARTIAL_PAYMENT_ROUTE]) {
      const source = read(file);
      expect(source, file).toContain("IdempotencyConflictError");
      expect(source, file).toMatch(/error instanceof IdempotencyConflictError[\s\S]{0,80}return fail\([\s\S]{0,80}409\)/);
    }
  });

  it("both routes surface the Idempotency-Replayed response header with a boolean string", () => {
    for (const file of [CHECKOUT_ROUTE, PARTIAL_PAYMENT_ROUTE]) {
      const source = read(file);
      expect(source, file).toContain('"Idempotency-Replayed": "true"');
      expect(source, file).toContain('"Idempotency-Replayed": "false"');
    }
  });
});

describe("idempotency source regression: operation registry and metadata safety", () => {
  it("registers checkout, partial-payment, refund, and return as financial idempotency operations", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toEqual([
      "order.checkout",
      "order.partial-payment",
      "order.refund",
      "order.return",
    ]);
  });

  it("idempotency.ts operation literals match the registered financial operations", () => {
    const source = read(IDEMPOTENCY_LIB);
    const operationLiterals = source.match(/"order\.[a-z-]+"/g) ?? [];
    const unique = [...new Set(operationLiterals.map((literal) => literal.slice(1, -1)))];
    expect(unique.sort()).toEqual(
      [...FINANCIAL_IDEMPOTENCY_OPERATIONS].sort(),
    );
  });

  it("checkout audit metadata builder never accepts or returns the raw idempotency key", () => {
    const source = read(AUDIT_METADATA);
    const start = source.indexOf("export function buildOrderCheckoutAuditMetadata");
    const nextExport = source.indexOf("\nexport ", start + 1);
    const block = source.slice(start, nextExport === -1 ? undefined : nextExport);
    expect(block).not.toMatch(/rawKey|idempotencyKey|Idempotency-Key/i);
  });

  it("partial-payment audit metadata builder never accepts or returns the raw idempotency key", () => {
    const source = read(AUDIT_METADATA);
    const start = source.indexOf("export function buildOrderPartialPaymentAuditMetadata");
    const nextExport = source.indexOf("\nexport ", start + 1);
    const block = source.slice(start, nextExport === -1 ? undefined : nextExport);
    expect(block).not.toMatch(/rawKey|idempotencyKey|Idempotency-Key/i);
  });

  it("the idempotency service never persists the raw key — only its digest — to the database", () => {
    const source = read(IDEMPOTENCY_SERVICE);
    const createStart = source.indexOf("idempotencyRecord.create");
    expect(createStart).toBeGreaterThan(-1);
    const createEnd = source.indexOf("});", createStart);
    expect(createEnd).toBeGreaterThan(createStart);
    const createBlock = source.slice(createStart, createEnd);
    expect(createBlock).not.toContain("rawKey");
    expect(createBlock).toContain("keyDigest");
  });

  it("the idempotency service exposes no configuration flag to disable idempotency (no optional/skip parameter)", () => {
    const source = read(IDEMPOTENCY_SERVICE);
    expect(source).not.toMatch(/skipIdempotency|bypassIdempotency|idempotencyDisabled/i);
  });

  it("hashIdempotencyKey and parseIdempotencyKey are exported directly from the security module, not re-derived per route", () => {
    const checkoutSource = read(CHECKOUT_ROUTE);
    const partialSource = read(PARTIAL_PAYMENT_ROUTE);
    for (const source of [checkoutSource, partialSource]) {
      expect(source).not.toContain("createHash(\"sha256\")");
    }
  });
});
