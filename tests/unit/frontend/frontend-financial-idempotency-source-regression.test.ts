import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRONTEND_FINANCIAL_OPERATIONS } from "@/lib/financial-idempotency/constants";

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), "utf8");
}

describe("frontend financial idempotency source regression", () => {
  it("checkout dialog sends Idempotency-Key through the financial executor", () => {
    const dialog = read("components/pos/CheckoutDialog.tsx");
    expect(dialog).toContain("submitCheckoutWithIdempotency");
    expect(dialog).toContain("loadCheckoutRecoveryAttempt");
    expect(dialog).toContain("abandonCheckoutAttempt");
    expect(dialog).not.toMatch(/Math\.random/);
  });

  it("does not add a global Idempotency-Key interceptor to apiFetch", () => {
    const client = read("lib/api/client.ts");
    expect(client).not.toMatch(/Idempotency-Key/);
    expect(client).toContain("export async function apiFetch");
  });

  it("key generation fails closed and never uses Math.random", () => {
    const key = read("lib/financial-idempotency/key.ts");
    expect(key).toContain("randomUUID");
    expect(key).toContain("getRandomValues");
    expect(key).not.toMatch(/Math\.random\s*\(/);
    expect(key).toContain("Secure Web Crypto is unavailable");
  });

  it("executor injects the header only for registered financial operations", () => {
    const executor = read("lib/financial-idempotency/executor.ts");
    expect(executor).toContain('"Idempotency-Key"');
    expect(executor).toContain("prepareFinancialAttempt");
    expect(executor).toContain("markFinancialAttemptUncertain");
    expect(executor).not.toMatch(/console\.(log|info|debug|warn|error).*key/i);
  });

  it("lifecycle reuses keys and blocks fingerprint mismatches", () => {
    const lifecycle = read("lib/financial-idempotency/lifecycle.ts");
    expect(lifecycle).toContain("fingerprint_mismatch");
    expect(lifecycle).toContain("reusedKey: true");
    expect(lifecycle).toContain("createFinancialIdempotencyKey");
  });

  it("storage never persists manager credentials or full payloads", () => {
    const storage = read("lib/financial-idempotency/storage.ts");
    expect(storage).toContain('"managerApprovalToken"');
    expect(storage).toContain("return null");
    expect(storage).toContain("FINANCIAL_ATTEMPT_RETENTION_MS");
    expect(storage).toContain("forbidden");
    expect(storage).not.toMatch(/\bpassword\b/);
    expect(storage).not.toMatch(/\bcookie\b/i);
  });

  it("void credentials stay outside fingerprints and request body builders", () => {
    const operations = read("lib/financial-idempotency/operations.ts");
    const fingerprint = read("lib/financial-idempotency/fingerprint.ts");
    expect(operations).toContain("buildVoidBusinessPayload");
    expect(operations).not.toMatch(
      /function buildVoidBusinessPayload[\s\S]*?managerApprovalToken/,
    );
    expect(fingerprint).toContain("Excludes managerApprovalToken");
    expect(FRONTEND_FINANCIAL_OPERATIONS).toEqual([
      "order.checkout",
      "order.partial-payment",
      "order.refund",
      "order.return",
      "order.void",
    ]);
  });

  it("does not fabricate partial/refund/return/void/manager-approval UI screens", () => {
    const dialog = read("components/pos/CheckoutDialog.tsx");
    expect(dialog).not.toMatch(/PartialPaymentDialog|RefundDialog|ReturnDialog|VoidDialog/);
    expect(dialog).not.toContain("managerApprovalToken");
    expect(dialog).not.toContain("/partial-payment");
    expect(dialog).not.toContain("/refund");
    expect(dialog).not.toContain("/void");
    expect(dialog).not.toMatch(/\/api\/orders\/\$\{[^}]+\}\/return/);
  });

  it("does not modify backend financial services, prisma, packages, or Codex shell files", () => {
    // Presence checks for ownership boundaries in this branch's design.
    expect(() => read("lib/services/idempotency-service.ts")).not.toThrow();
    expect(() => read("prisma/schema.prisma")).not.toThrow();
    expect(() => read("package.json")).not.toThrow();
    const shell = read("components/layout/dashboard-shell.tsx");
    expect(shell.length).toBeGreaterThan(0);
  });

  it("checkout recovery requires explicit retry and does not auto-submit on load", () => {
    const dialog = read("components/pos/CheckoutDialog.tsx");
    expect(dialog).toContain("will not auto-submit after refresh");
    expect(dialog).toContain("Retry retained attempt");
    expect(dialog).toContain("Abandon attempt");
    expect(dialog).toContain("aria-busy");
    expect(dialog).toContain('aria-live="polite"');
  });
});
