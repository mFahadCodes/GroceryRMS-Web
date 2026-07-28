import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISCOUNTABLE_ORDER_STATUSES,
} from "@/lib/security/discount-concurrency";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), "utf8");
}

const DISCOUNT_ROUTE = "app/api/orders/[id]/discount/route.ts";
const DISCOUNT_CONCURRENCY = "lib/security/discount-concurrency.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const IDEMPOTENCY_LIB = "lib/security/idempotency.ts";
const CHECKOUT_DIALOG = "components/pos/CheckoutDialog.tsx";

describe("discount source regression", () => {
  it("registers order.discount in the financial idempotency map", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain("order.discount");
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

  it("discount route requires Idempotency-Key and resolves replay before approval", () => {
    const source = read(DISCOUNT_ROUTE);
    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toContain("parseIdempotencyKey");
    expect(source).toContain('operation: "order.discount"');
    expect(source).toContain("executeFinancialIdempotent");
    expect(source).toContain("applyOrderDiscountBusinessSchema");
    expect(source).not.toMatch(/managerPin|verifyPin/i);
    const executeStart = source.indexOf("execute: async (tx)");
    expect(executeStart).toBeGreaterThan(-1);
    const executeBlock = source.slice(executeStart);
    expect(executeBlock).toContain("applyOrderDiscountManagerApprovalTokenSchema");
    expect(executeBlock).toContain("applyOrderDiscount(");
  });

  it("business payload excludes managerApprovalToken from the request digest envelope", () => {
    const source = read(DISCOUNT_ROUTE);
    expect(source).toContain("requestPayload");
    expect(source).toMatch(/discountAmount[\s\S]*discountPercent[\s\S]*reason/);
    const payloadBlock = source.slice(
      source.indexOf("const requestPayload"),
      source.indexOf("try {"),
    );
    expect(payloadBlock).not.toContain("managerApprovalToken");
  });

  it("DISCOUNTABLE_ORDER_STATUSES is Open-only and shared by validation and CAS", () => {
    expect([...DISCOUNTABLE_ORDER_STATUSES]).toEqual(["Open"]);
    const concurrency = read(DISCOUNT_CONCURRENCY);
    expect(concurrency).toContain("DISCOUNTABLE_ORDER_STATUSES");
    expect(concurrency).toContain('status: { in: [...DISCOUNTABLE_ORDER_STATUSES] }');
    expect(concurrency).toContain("discountAmount: prior.discountAmount");
    expect(concurrency).toContain("taxAmount: prior.taxAmount");
    expect(concurrency).toContain("grandTotal: prior.grandTotal");
    expect(concurrency).not.toMatch(/status:\s*\{\s*not:/);
    expect(concurrency).not.toMatch(/PartiallyPaid|Packed|Delivered|Closed/);
    const service = read(ORDER_SERVICE);
    expect(service).toContain("assertOrderDiscountable");
    expect(service).toContain("claimDiscountMutation");
  });

  it("discount mutation uses the outer transaction client and no nested $transaction", () => {
    const service = read(ORDER_SERVICE);
    const start = service.indexOf("export async function applyOrderDiscount");
    const next = service.indexOf("\nexport async function", start + 1);
    const block = service.slice(start, next === -1 ? undefined : next);
    expect(block).toContain("txClient?: Prisma.TransactionClient");
    expect(block).toContain("if (txClient) return run(txClient)");
    expect(block).not.toMatch(/\$transaction\s*\(\s*async/);
    expect(block).not.toMatch(/prisma\.order\.update/);
    expect(block).toContain("claimDiscountMutation(tx");
    expect(block).toContain("consumeManagerApprovalGrant(tx");
    expect(block).toContain("writeRequiredAudit(tx");
  });

  it("CAS is not id-only and claim precedes approval consumption", () => {
    const concurrency = read(DISCOUNT_CONCURRENCY);
    expect(concurrency).toContain("updateMany");
    expect(concurrency).not.toMatch(
      /updateMany\(\{\s*where:\s*\{\s*id:\s*orderId\s*\}\s*,/,
    );
    const service = read(ORDER_SERVICE);
    const start = service.indexOf("export async function applyOrderDiscount");
    const next = service.indexOf("\nexport async function", start + 1);
    const block = service.slice(start, next === -1 ? undefined : next);
    const claimIdx = block.indexOf("claimDiscountMutation");
    const consumeIdx = block.indexOf("consumeManagerApprovalGrant");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(consumeIdx).toBeGreaterThan(claimIdx);
  });

  it("raw idempotency keys are never stored", () => {
    const service = read("lib/services/idempotency-service.ts");
    expect(service).toContain("hashIdempotencyKey");
    expect(service).toContain("keyDigest");
    expect(service).not.toMatch(/data:\s*\{[^}]*rawKey/);
  });

  it("does not change checkout frontend or invent discount UI", () => {
    const dialog = read(CHECKOUT_DIALOG);
    expect(dialog).not.toContain("/discount");
    expect(dialog).not.toContain("order.discount");
  });

  it("idempotency.ts includes the order.discount literal exactly once in the registry", () => {
    const source = read(IDEMPOTENCY_LIB);
    const matches = source.match(/"order\.discount"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("rejects re-adding PartiallyPaid or fulfilment statuses to the allowlist", () => {
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("PartiallyPaid");
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("Packed");
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("OutForDelivery");
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("Delivered");
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("Closed");
    expect([...DISCOUNTABLE_ORDER_STATUSES]).not.toContain("Void");
  });

  it("fails if discount CAS becomes a broad negative status predicate", () => {
    const concurrency = read(DISCOUNT_CONCURRENCY);
    expect(concurrency).not.toMatch(/status:\s*\{\s*notIn:/);
    expect(concurrency).not.toMatch(/status:\s*\{\s*not:/);
    expect(concurrency).not.toMatch(/!=\s*["']Closed["']/);
    expect(concurrency).not.toMatch(/!==\s*["']Void["']/);
  });

  it("fails if approval validation moves before executeFinancialIdempotent", () => {
    const source = read(DISCOUNT_ROUTE);
    const idempotentIdx = source.indexOf("executeFinancialIdempotent");
    expect(idempotentIdx).toBeGreaterThan(-1);
    const executeStart = source.indexOf("execute: async (tx)", idempotentIdx);
    expect(executeStart).toBeGreaterThan(idempotentIdx);
    const executeBlock = source.slice(executeStart);
    expect(executeBlock).toContain("applyOrderDiscountManagerApprovalTokenSchema");
    const beforeExecute = source.slice(0, executeStart);
    expect(beforeExecute).not.toContain(
      "applyOrderDiscountManagerApprovalTokenSchema.safeParse",
    );
  });

  it("fails if approval credentials enter the request digest payload", () => {
    const source = read(DISCOUNT_ROUTE);
    const payloadBlock = source.slice(
      source.indexOf("const requestPayload"),
      source.indexOf("try {"),
    );
    expect(payloadBlock).not.toMatch(/managerApprovalToken|managerPin|PIN/i);
  });

  it("fails if a root Prisma mutation is introduced on the protected discount path", () => {
    const source = read(DISCOUNT_ROUTE);
    expect(source).not.toMatch(/prisma\.order\.(update|updateMany)/);
    expect(source).not.toMatch(/prisma\.\$transaction/);
    const service = read(ORDER_SERVICE);
    const start = service.indexOf("export async function applyOrderDiscount");
    const next = service.indexOf("\nexport async function", start + 1);
    const block = service.slice(start, next === -1 ? undefined : next);
    expect(block).not.toMatch(/prisma\.order\.(update|updateMany)/);
  });

  it("surfaces IdempotencyConflictError and ServiceError through the discount route", () => {
    const source = read(DISCOUNT_ROUTE);
    expect(source).toContain("IdempotencyConflictError");
    expect(source).toContain("ManagerApprovalServiceError");
    expect(source).toContain("ServiceError");
    expect(source).toContain('"Idempotency-Replayed"');
  });

  it("does not add a Prisma schema migration for P0-E", () => {
    const concurrency = read(DISCOUNT_CONCURRENCY);
    expect(concurrency).not.toMatch(/version|rowVersion|optimisticLock/i);
  });
});