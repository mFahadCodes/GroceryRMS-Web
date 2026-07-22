import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_EVENTS } from "../../../lib/security/audit-policy";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const CLOSE_ROUTES = [
  "app/api/shifts/route.ts",
  "app/api/shifts/[id]/close/route.ts",
] as const;

describe("shift close source regression", () => {
  it("registers SHIFT_CLOSE through required() in the policy registry", () => {
    const policy = read("lib/security/audit-policy.ts");
    expect(policy).toMatch(/SHIFT_CLOSE:\s*required\("shifts"\)/);
    expect(AUDIT_EVENTS.SHIFT_CLOSE.mode).toBe("TRANSACTION_REQUIRED");
  });

  it("registers CLOSE_SHIFT through required() in the policy registry", () => {
    const policy = read("lib/security/audit-policy.ts");
    expect(policy).toMatch(/CLOSE_SHIFT:\s*required\("shifts"\)/);
    expect(AUDIT_EVENTS.CLOSE_SHIFT.mode).toBe("TRANSACTION_REQUIRED");
  });

  it("shift-service uses writeRequiredAudit for close", () => {
    const source = read("lib/services/shift-service.ts");
    expect(source).toContain("writeRequiredAudit");
    expect(source).toMatch(/writeRequiredAudit\(\s*tx\s*,/);
  });

  it("shift-service does not use writeBestEffortAudit", () => {
    const source = read("lib/services/shift-service.ts");
    expect(source).not.toContain("writeBestEffortAudit");
  });

  it("shift-service does not import or call auditFromRequest", () => {
    const source = read("lib/services/shift-service.ts");
    expect(source).not.toContain("auditFromRequest");
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bauditFromRequest\b[^}]*\}\s*from/,
    );
  });

  it("close routes do not call auditFromRequest for close", () => {
    const collectionRoute = read("app/api/shifts/route.ts");
    const closeRoute = read("app/api/shifts/[id]/close/route.ts");

    expect(closeRoute).not.toContain("auditFromRequest");
    expect(closeRoute).toContain('auditAction: "SHIFT_CLOSE"');

    // OPEN_SHIFT may still use auditFromRequest; close must not.
    const closeBranch = collectionRoute.slice(
      collectionRoute.indexOf("// SEC-05C: CLOSE_SHIFT"),
    );
    expect(closeBranch).toContain('auditAction: "CLOSE_SHIFT"');
    expect(closeBranch).not.toContain("auditFromRequest");
  });

  it("closeShift owns the audit write inside the Prisma transaction", () => {
    const source = read("lib/services/shift-service.ts");
    expect(source).toContain("prisma.$transaction");
    expect(source).toContain("writeRequiredAudit(tx,");
    expect(source).toContain("updateMany");
    expect(source).toMatch(/endedAt:\s*null/);
  });

  it("does not use a post-commit close audit pattern", () => {
    for (const file of [
      "lib/services/shift-service.ts",
      ...CLOSE_ROUTES,
    ] as const) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /await\s+closeShift\([\s\S]{0,400}auditFromRequest/,
      );
      expect(source, file).not.toMatch(
        /closeShift\([\s\S]{0,400}\)\s*;\s*await\s+auditFromRequest/,
      );
    }
  });

  it("buildShiftCloseAuditMetadata is present and used by closeShift", () => {
    const metadata = read("lib/security/audit-metadata.ts");
    expect(metadata).toContain("export function buildShiftCloseAuditMetadata");
    expect(metadata).toContain("summarizeFreeTextReason(input.notes)");

    const service = read("lib/services/shift-service.ts");
    expect(service).toContain("buildShiftCloseAuditMetadata");
    expect(service).toMatch(
      /newValues:\s*buildShiftCloseAuditMetadata\(/,
    );
  });

  it("does not return raw notes text from the shift-close metadata builder", () => {
    const source = read("lib/security/audit-metadata.ts");
    const start = source.indexOf(
      "export function buildShiftCloseAuditMetadata",
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf("\nexport ", start + 1);
    const block = source.slice(
      start,
      nextExport === -1 ? undefined : nextExport,
    );
    expect(block).toContain("summarizeFreeTextReason(input.notes)");
    const returnMatch = block.match(/return\s*\{([\s\S]*)\}\s*;?\s*$/);
    expect(returnMatch).toBeTruthy();
    const returned = returnMatch![1];
    expect(returned).not.toMatch(/\bnotes\s*:/);
    expect(returned).not.toMatch(/reason\s*:/);
    expect(returned).not.toContain("input.notes,");
    expect(returned).not.toMatch(/notes:\s*input\.notes/);
  });

  it("close routes pass auditAction and auditIpAddress into closeShift", () => {
    const collectionRoute = read("app/api/shifts/route.ts");
    const closeRoute = read("app/api/shifts/[id]/close/route.ts");
    expect(collectionRoute).toContain("auditAction: \"CLOSE_SHIFT\"");
    expect(collectionRoute).toContain("auditIpAddress:");
    expect(closeRoute).toContain("auditAction: \"SHIFT_CLOSE\"");
    expect(closeRoute).toContain("auditIpAddress:");
  });
});
