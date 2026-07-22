import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

function listTsFiles(dir: string): string[] {
  const absolute = path.resolve(dir);
  const entries = readdirSync(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

const CRITICAL_ACTIONS = [
  "PASSWORD_CHANGED",
  "VOID_ORDER",
  "CHECKOUT",
  "REFUND_ORDER",
  "FORCE_LOGOUT",
  "REPLACE_ROLE_PERMISSIONS",
  "CREATE_USER",
  "UPDATE_USER",
  "DELETE_USER",
  "UPSERT_SETTING",
  "PARTIAL_PAYMENT",
  "APPLY_ORDER_DISCOUNT",
  "RETURN",
  "RECEIVE_PURCHASE_ORDER",
  "APPLY_STOCK_TAKE",
  "MANAGER_APPROVAL_ISSUED",
  "MANAGER_APPROVAL_CONSUMED",
] as const;

const CRITICAL_SERVICE_FILES = [
  "lib/services/password-service.ts",
  "lib/services/order-service.ts",
  "lib/services/settings-service.ts",
  "lib/services/session-service.ts",
  "lib/services/inventory-service.ts",
  "lib/services/manager-approval-service.ts",
  "lib/services/pin-security-service.ts",
] as const;

describe("audit policy source regression", () => {
  it("does not use writeBestEffortAudit for the same critical action as writeRequiredAudit", () => {
    const files = [...listTsFiles("app"), ...listTsFiles("lib")].filter(
      (file) => !file.endsWith(`${path.sep}audit.ts`),
    );
    const sources = files.map((file) => ({ file, source: read(file) }));
    for (const action of CRITICAL_ACTIONS) {
      const bestEffortFiles = sources
        .filter(
          ({ source }) =>
            source.includes("writeBestEffortAudit") &&
            source.includes(`"${action}"`),
        )
        .map(({ file }) => file);
      expect(bestEffortFiles, action).toEqual([]);
      const requiredFiles = sources.filter(
        ({ source }) =>
          source.includes("writeRequiredAudit") &&
          source.includes(`"${action}"`),
      );
      expect(requiredFiles.length, action).toBeGreaterThan(0);
    }
  }, 15_000);

  it("fails if lib/services critical files still import writeAuditRecord or auditLog helpers", () => {
    for (const file of CRITICAL_SERVICE_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /import\s*\{[^}]*\bwriteAuditRecord\b[^}]*\}\s*from/,
      );
      expect(source, file).not.toMatch(
        /import\s*\{[^}]*\bauditLog\b[^}]*\}\s*from/,
      );
      expect(source, file).not.toContain("writeAuditRecord(");
      expect(source, file).toContain("writeRequiredAudit");
    }
  });

  it("fails if callers pass mode, bestEffort, or ignoreAuditFailure audit flags", () => {
    const files = [...listTsFiles("app"), ...listTsFiles("lib")].filter(
      (file) =>
        !file.endsWith(`${path.sep}audit.ts`) &&
        !file.endsWith(`${path.sep}audit-policy.ts`),
    );
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bignoreAuditFailure\b/);
      expect(source, file).not.toMatch(
        /write(?:Required|BestEffort|Access)Audit\([\s\S]{0,200}\bmode\s*:/,
      );
      expect(source, file).not.toMatch(
        /write(?:Required|BestEffort|Access)Audit\([\s\S]{0,200}\bbestEffort\s*:/,
      );
    }
  }, 15_000);

  it("fails if void/discount builders still return a reason string field", () => {
    const source = read("lib/security/audit-metadata.ts");
    const voidStart = source.indexOf(
      "export function buildOrderVoidAuditMetadata",
    );
    const discountStart = source.indexOf(
      "export function buildOrderDiscountAuditMetadata",
    );
    const checkoutStart = source.indexOf(
      "export function buildOrderCheckoutAuditMetadata",
    );
    expect(voidStart).toBeGreaterThanOrEqual(0);
    expect(discountStart).toBeGreaterThan(voidStart);
    expect(checkoutStart).toBeGreaterThan(discountStart);
    const voidFn = source.slice(voidStart, discountStart);
    const discountFn = source.slice(discountStart, checkoutStart);
    expect(source).toContain("export type FreeTextAuditSummary");
    expect(source).toContain("reasonProvided: boolean");
    expect(voidFn).toContain("summarizeFreeTextReason(input.reason)");
    expect(discountFn).toContain("summarizeFreeTextReason(input.reason)");
    expect(voidFn).not.toMatch(/reason:\s*input\.reason/);
    expect(discountFn).not.toMatch(/reason:\s*input\.reason/);
    expect(voidFn).not.toMatch(/return \{[\s\S]*\breason:\s/);
    expect(discountFn).not.toMatch(/return \{[\s\S]*\breason:\s/);
  });

  it("fails if high-risk checkout/refund/void routes audit critical actions via auditFromRequest", () => {
    for (const [file, action] of [
      ["app/api/orders/[id]/checkout/route.ts", "CHECKOUT"],
      ["app/api/orders/[id]/refund/route.ts", "REFUND_ORDER"],
      ["app/api/orders/[id]/void/route.ts", "VOID_ORDER"],
    ] as const) {
      const source = read(file);
      expect(source, file).not.toContain("auditFromRequest");
      expect(source, file).not.toMatch(
        new RegExp(`auditFromRequest\\([\\s\\S]*?${action}`),
      );
      expect(source, file).not.toContain(`action: "${action}"`);
    }
  });

  it("fails if orders/[id]/route.ts passes parsed.data as newValues", () => {
    const source = read("app/api/orders/[id]/route.ts");
    expect(source).not.toMatch(/newValues:\s*parsed\.data\b/);
    expect(source).toContain("buildOrderItemAddedAuditMetadata");
    expect(source).toContain("buildOrderMetadataUpdateAuditMetadata");
  });

  it("soft-checks against unregistered dynamic action template strings", () => {
    const files = [...listTsFiles("app"), ...listTsFiles("lib")].filter(
      (file) => !file.endsWith(`${path.sep}audit.ts`),
    );
    const dynamicActionPattern =
      /action:\s*`[A-Z0-9_]*\$\{[^}]+\}[A-Z0-9_]*`/;
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(dynamicActionPattern);
    }
  }, 15_000);
});
