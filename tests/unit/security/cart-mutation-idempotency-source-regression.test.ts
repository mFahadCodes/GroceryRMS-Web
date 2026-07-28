import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), "utf8");
}

const TAX_ROUTE = "app/api/orders/[id]/tax/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const ITEM_ID_ROUTE = "app/api/orders/[id]/items/[itemId]/route.ts";
const ADJUSTMENT_ROUTE = "app/api/orders/[id]/adjustment/route.ts";
const GENERIC_PUT_ROUTE = "app/api/orders/[id]/route.ts";

const CART_MUTATION_OPERATIONS = [
  "order.apply-tax",
  "order.apply-adjustment",
  "order.add-item",
  "order.update-item-quantity",
] as const;

describe("cart mutation idempotency source regression", () => {
  it("registers all four cart mutation operations", () => {
    for (const operation of CART_MUTATION_OPERATIONS) {
      expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain(operation);
    }
  });

  it.each([
    [TAX_ROUTE, "order.apply-tax"],
    [ADJUSTMENT_ROUTE, "order.apply-adjustment"],
    [ITEMS_ROUTE, "order.add-item"],
    [ITEM_ID_ROUTE, "order.update-item-quantity"],
  ] as const)(
    "%s wires executeFinancialIdempotent with %s",
    (file, operation) => {
      const source = read(file);
      expect(source).toContain("executeFinancialIdempotent");
      expect(source).toContain(`operation: "${operation}"`);
      expect(source).toContain('request.headers.get("idempotency-key")');
      expect(source).toContain("authoritativeTerminalId:");
      expect(source).toMatch(/authoritativeTerminalId:\s*auth\.session\.authoritative\?\.terminalId\s*\?\?\s*null/);
      expect(source).toContain('resourceId: orderId');
    },
  );

  it("PATCH item route rejects quantity and voidReason together", () => {
    const source = read(ITEM_ID_ROUTE);
    expect(source).toContain("PATCH_ORDER_ITEM_CONFLICT");
    expect(source).toMatch(/hasQuantity\s*&&\s*hasVoidReason/);
  });

  it("PATCH item route only requires idempotency for quantity updates", () => {
    const source = read(ITEM_ID_ROUTE);
    const quantityBlockStart = source.indexOf("if (hasQuantity)");
    const voidBlockStart = source.indexOf("if (hasVoidReason)");
    expect(quantityBlockStart).toBeGreaterThan(-1);
    expect(voidBlockStart).toBeGreaterThan(quantityBlockStart);
    const quantityBlock = source.slice(quantityBlockStart, voidBlockStart);
    expect(quantityBlock).toContain("parseIdempotencyKey");
    expect(quantityBlock).toContain("executeFinancialIdempotent");
    const voidBlock = source.slice(voidBlockStart);
    expect(voidBlock).not.toContain("executeFinancialIdempotent");
  });

  it("generic PUT requires idempotency for addItem and updateItem only", () => {
    const source = read(GENERIC_PUT_ROUTE);
    expect(source).toContain('case "addItem"');
    expect(source).toContain('case "updateItem"');
    expect(source).toContain('operation: "order.add-item"');
    expect(source).toContain('operation: "order.update-item-quantity"');

    const addItemStart = source.indexOf('case "addItem"');
    const updateItemStart = source.indexOf('case "updateItem"');
    const removeItemStart = source.indexOf('case "removeItem"');
    const addItemBlock = source.slice(addItemStart, updateItemStart);
    const updateItemBlock = source.slice(updateItemStart, removeItemStart);
    const removeItemBlock = source.slice(
      removeItemStart,
      source.indexOf('case "updateMeta"'),
    );

    expect(addItemBlock).toContain("parseIdempotencyKey");
    expect(updateItemBlock).toContain("parseIdempotencyKey");
    expect(removeItemBlock).not.toContain("parseIdempotencyKey");
    expect(removeItemBlock).not.toContain("executeFinancialIdempotent");
  });
});
