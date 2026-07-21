import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const GENERIC_ROUTE = "app/api/orders/[id]/route.ts";
const ORDER_SERVICE = "lib/services/order-service.ts";
const ORDER_VALIDATORS = "lib/validators/order.validators.ts";

function importBlock(source: string): string {
  return (
    source.match(/import[\s\S]*?from\s*["'][^"']+["'];?/g) ?? []
  ).join("\n");
}

function extractBlock(source: string, startMarker: RegExp): string {
  const match = source.match(startMarker);
  expect(match, `expected to find ${startMarker} in source`).toBeTruthy();
  return match![0];
}

describe("generic order update source regression", () => {
  it("does not import privileged action services into the generic route", () => {
    const imports = importBlock(read(GENERIC_ROUTE));
    for (const helper of [
      "applyOrderDiscount",
      "voidOrder",
      "holdOrder",
      "recallOrder",
      "checkoutFast",
      "refundOrder",
      "returnOrderItems",
      "applyPartialPayment",
      "applyOrderTax",
      "applyOrderAdjustment",
      "dispatchOrder",
      "markOrderDelivered",
    ]) {
      expect(imports).not.toContain(helper);
    }
  });

  it("does not consume manager approvals or verify manager PINs in the generic route", () => {
    const source = read(GENERIC_ROUTE);
    expect(source).not.toContain("consumeManagerApprovalGrant");
    expect(source).not.toContain("issueManagerApprovalGrant");
    expect(source).not.toContain("managerApprovalToken");
    expect(source).not.toContain("managerPin");
    expect(source).not.toContain("managerUserId");
    expect(source).not.toMatch(/from ["']@\/lib\/manager-pin["']/);
    expect(source).not.toMatch(
      /from ["']@\/lib\/services\/manager-approval-service["']/,
    );
  });

  it("contains no magic note command dispatch", () => {
    const source = read(GENERIC_ROUTE);
    expect(source).not.toContain("normalizedNotes");
    expect(source).not.toMatch(/toLowerCase\(\)/);
    expect(source).not.toMatch(/===\s*["']hold["']/);
    expect(source).not.toMatch(/===\s*["']recall["']/);
    expect(source).not.toMatch(/startsWith\(\s*["']void:/);
    expect(source).not.toMatch(/\.slice\(\s*5\s*\)/);
  });

  it("does not talk to Prisma directly from the generic route", () => {
    const source = read(GENERIC_ROUTE);
    expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
    expect(source).not.toContain("prisma.order.update");
  });

  it("never spreads parsed request input into a database write", () => {
    for (const file of [GENERIC_ROUTE, ORDER_SERVICE]) {
      const source = read(file);
      expect(source).not.toMatch(/data:\s*\{\s*\.\.\.(parsed|body|input|request)/);
      expect(source).not.toMatch(/update\(\s*\{[^}]*\.\.\.parsed/s);
    }
  });

  it("keeps the safe metadata service typed and free of dynamic key iteration", () => {
    const source = read(ORDER_SERVICE);
    const block = extractBlock(
      source,
      /export async function updateOrderMetadata[\s\S]*?\n\}/,
    );
    expect(block).not.toContain("Record<string,");
    expect(block).not.toContain("Record<string, unknown>");
    expect(block).not.toMatch(/for\s*\(\s*const\s+\w+\s+(in|of)\s+/);
    expect(block).not.toMatch(/Object\.(keys|entries|assign)\(/);
    expect(block).not.toContain("...input");
    expect(block).not.toContain("consumeManagerApprovalGrant");
    expect(block).toContain("input.notes");
    expect(block).toContain("input.customerId");
  });

  it("keeps protected fields out of the generic metadata validator", () => {
    const source = read(ORDER_VALIDATORS);
    const block = extractBlock(
      source,
      /export const updateOrderMetaSchema[\s\S]*?\n\s*\);/,
    );
    expect(block).toContain(".strict()");
    for (const field of [
      "discountPercent",
      "discountAmount",
      "adjustment",
      "taxPercent",
      "subTotal",
      "grandTotal",
      "status",
      "managerApprovalToken",
      "managerPin",
      "managerUserId",
      "approvedByUserId",
      "payments",
      "items",
      "shiftId",
      "terminalId",
      "cashierId",
    ]) {
      expect(block).not.toContain(field);
    }
  });

  it("keeps every generic modify action schema strict", () => {
    const source = read(ORDER_VALIDATORS);
    for (const schema of [
      "addItemSchema",
      "updateItemSchema",
      "removeItemSchema",
      "updateOrderMetaSchema",
    ]) {
      const block = extractBlock(
        source,
        new RegExp(`export const ${schema}[\\s\\S]*?\\n(?=export )`),
      );
      expect(block).toContain(".strict()");
    }
  });

  it("bounds the generic modify request body", () => {
    const source = read(GENERIC_ROUTE);
    expect(source).toContain("MAX_MODIFY_ORDER_REQUEST_BYTES");
    expect(source).toContain("readBoundedJson");
  });

  it("enforces an explicit maximum note length in the metadata validator", () => {
    const source = read(ORDER_VALIDATORS);
    expect(source).toContain("ORDER_META_NOTES_MAX_LENGTH");
    const block = extractBlock(
      source,
      /export const updateOrderMetaSchema[\s\S]*?\n\s*\);/,
    );
    expect(block).toMatch(/\.max\(ORDER_META_NOTES_MAX_LENGTH\)/);
  });

  it("does not log request bodies or note content from the generic route", () => {
    const source = read(GENERIC_ROUTE);
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it("keeps the dedicated discount and void routes on manager approval tokens", () => {
    for (const file of [
      "app/api/orders/[id]/discount/route.ts",
      "app/api/orders/[id]/void/route.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("managerApprovalToken");
      expect(source).not.toContain("managerPin");
      expect(source).not.toContain("managerUserId");
    }
  });
});
