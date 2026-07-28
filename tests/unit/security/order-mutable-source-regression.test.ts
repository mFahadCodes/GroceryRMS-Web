import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MUTABLE_ORDER_STATUSES } from "@/lib/security/order-mutable-concurrency";
import { AUDIT_EVENTS } from "@/lib/security/audit-policy";

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), "utf8");
}

function functionBlock(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  expect(start, exportName).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport async function", start + 1);
  const nextFn = source.indexOf("\nasync function", start + 1);
  const endCandidates = [next, nextFn].filter((i) => i > start);
  const end =
    endCandidates.length === 0 ? source.length : Math.min(...endCandidates);
  return source.slice(start, end);
}

const TAX_ROUTE = "app/api/orders/[id]/tax/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const ITEM_ID_ROUTE = "app/api/orders/[id]/items/[itemId]/route.ts";
const ADJUSTMENT_ROUTE = "app/api/orders/[id]/adjustment/route.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const CONCURRENCY = "lib/security/order-mutable-concurrency.ts";

describe("order mutable source regression", () => {
  it("MUTABLE_ORDER_STATUSES contains exactly Open", () => {
    expect([...MUTABLE_ORDER_STATUSES]).toEqual(["Open"]);
  });

  it("tax/item/adjustment routes do not contain auditFromRequest", () => {
    for (const file of [TAX_ROUTE, ITEMS_ROUTE, ITEM_ID_ROUTE, ADJUSTMENT_ROUTE]) {
      const source = read(file);
      expect(source, file).not.toContain("auditFromRequest");
    }
  });

  it("promotes mutable-surface audits to TRANSACTION_REQUIRED", () => {
    for (const action of [
      "APPLY_ORDER_TAX",
      "ADD_ORDER_ITEM",
      "PATCH_ORDER_ITEM",
      "DELETE_ORDER_ITEM",
      "UPDATE_ORDER_ITEM",
      "VOID_ORDER_ITEM",
      "UPDATE_ORDER_ADJUSTMENT",
    ] as const) {
      expect(AUDIT_EVENTS[action].mode).toBe("TRANSACTION_REQUIRED");
    }
  });

  it("applyOrderTax uses transaction client CAS and required audit", () => {
    const block = functionBlock(read(ORDER_SERVICE), "applyOrderTax");
    expect(block).toContain("acquireOpenOrderWrite(tx");
    expect(block).toContain("claimRecalculatedOpenOrderTotals");
    expect(block).toContain("writeRequiredAudit(tx");
    expect(block).toContain('action: "APPLY_ORDER_TAX"');
    expect(block).not.toMatch(/prisma\.order\.update\b/);
    expect(block).toContain("if (txClient) return run(txClient)");
  });

  it("addItemToOrder does not use root prisma.orderItem mutations", () => {
    const block = functionBlock(read(ORDER_SERVICE), "addItemToOrder");
    expect(block).toContain("acquireOpenOrderWrite(tx");
    expect(block).toContain("tx.orderItem");
    expect(block).not.toMatch(/prisma\.orderItem\.(create|update|findFirst)/);
    expect(block).toContain("writeRequiredAudit(tx");
  });

  it("updateItemQuantity does not use root prisma.orderItem update/delete", () => {
    const block = functionBlock(read(ORDER_SERVICE), "updateItemQuantity");
    expect(block).toContain("acquireOpenOrderWrite(tx");
    expect(block).toContain("tx.orderItem");
    expect(block).not.toMatch(/prisma\.orderItem\.(update|delete)/);
    expect(block).toContain("writeRequiredAudit(tx");
  });

  it("removeOrderItem does not use root prisma.orderItem.update", () => {
    const block = functionBlock(read(ORDER_SERVICE), "removeOrderItem");
    expect(block).toContain("acquireOpenOrderWrite(tx");
    expect(block).toContain("tx.orderItem.update");
    expect(block).not.toMatch(/prisma\.orderItem\.update/);
    expect(block).toContain("writeRequiredAudit(tx");
  });

  it("applyOrderAdjustment does not use root prisma.order.update", () => {
    const block = functionBlock(read(ORDER_SERVICE), "applyOrderAdjustment");
    expect(block).toContain("acquireOpenOrderWrite(tx");
    expect(block).toContain("claimRecalculatedOpenOrderTotals");
    expect(block).toContain("writeRequiredAudit(tx");
    expect(block).not.toMatch(/prisma\.order\.update\b/);
  });

  it("CAS helpers require count === 1 and Open allowlist", () => {
    const concurrency = read(CONCURRENCY);
    expect(concurrency).toContain("MUTABLE_ORDER_STATUSES");
    expect(concurrency).toContain("claimed.count === 1");
    expect(concurrency).toContain("status: { in: [...MUTABLE_ORDER_STATUSES] }");
    expect(concurrency).not.toMatch(/status:\s*\{\s*notIn:/);
    expect(concurrency).not.toMatch(/PartiallyPaid/);
  });

  it("cart mutation routes use durable idempotency (P1-A)", () => {
    for (const file of [TAX_ROUTE, ITEMS_ROUTE, ITEM_ID_ROUTE, ADJUSTMENT_ROUTE]) {
      const source = read(file);
      expect(source, file).toContain("idempotency-key");
      expect(source, file).toContain("executeFinancialIdempotent");
    }
    const itemRoute = read(ITEM_ID_ROUTE);
    expect(itemRoute).toContain("PATCH_ORDER_ITEM_CONFLICT");
  });
});
