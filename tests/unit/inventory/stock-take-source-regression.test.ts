import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCIAL_IDEMPOTENCY_OPERATIONS } from "@/lib/security/idempotency";
import { APPLICABLE_STOCK_TAKE_STATUSES } from "@/lib/security/stock-take-concurrency";

describe("stock-take-source-regression", () => {
  it("FINANCIAL_IDEMPOTENCY_OPERATIONS includes inventory.stock-take-apply", () => {
    expect(FINANCIAL_IDEMPOTENCY_OPERATIONS).toContain("inventory.stock-take-apply");
  });

  it("APPLICABLE_STOCK_TAKE_STATUSES contains strictly InProgress", () => {
    expect(APPLICABLE_STOCK_TAKE_STATUSES).toEqual(["InProgress"]);
  });

  it("stock-take-concurrency.ts implements CAS updateMany claim pattern", () => {
    const fileContent = readFileSync(
      path.resolve("lib/security/stock-take-concurrency.ts"),
      "utf8",
    );
    expect(fileContent).toMatch(/tx\.stockTake\.updateMany/);
    expect(fileContent).toMatch(/result\.count !== 1/);
    expect(fileContent).toMatch(/STOCK_TAKE_NOT_IN_PROGRESS/);
  });

  it("idempotency-service.ts resourceType accepts stock_takes", () => {
    const fileContent = readFileSync(
      path.resolve("lib/services/idempotency-service.ts"),
      "utf8",
    );
    expect(fileContent).toMatch(/resourceType:\s*"orders"\s*\|\s*"stock_takes"/);
  });

  it("inventory-service.ts applyStockTake claims completion before items loop", () => {
    const fileContent = readFileSync(
      path.resolve("lib/services/inventory-service.ts"),
      "utf8",
    );

    const claimIndex = fileContent.indexOf("claimStockTakeCompletion");
    const auditIndex = fileContent.indexOf("APPLY_STOCK_TAKE");

    expect(claimIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeLessThan(auditIndex);

    // Verify createStockTake uses a transaction (via injected client or prisma)
    expect(fileContent).toMatch(/export async function createStockTake[\s\S]*?\$transaction/);
    // Verify the fallback is always prisma (not an arbitrary client with no default)
    expect(fileContent).toMatch(/input\.client\s*\?\?\s*prisma/);
  });
});
