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

describe("audit source regression", () => {
  it("routes all AuditLog writes through the central write boundary", () => {
    const files = [
      ...listTsFiles("app"),
      ...listTsFiles("lib"),
    ].filter(
      (file) =>
        !file.includes(`${path.sep}node_modules${path.sep}`) &&
        !file.endsWith(`${path.sep}audit.ts`),
    );
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/\.auditLog\.create\s*\(/);
    }
    expect(read("lib/audit.ts")).toContain("writeAuditRecord");
    expect(read("lib/audit.ts")).toContain("serializeSafeAuditMetadata");
    expect(read("lib/audit.ts")).toContain("mapAuditLogForResponse");
  });

  it("does not allow sanitizer bypass flags in the audit module", () => {
    const source = read("lib/audit.ts");
    expect(source).not.toContain("skipSanitize");
    expect(source).not.toContain("alreadySanitized");
    expect(source).not.toContain("rawNewValues");
  });

  it("security metadata builders never accept password, PIN, token, or session identifiers", () => {
    const source = read("lib/security/audit-metadata.ts");
    expect(source).not.toMatch(
      /\b(password|currentPassword|newPassword|managerPin|approvalToken|tokenHash|sessionId|cookie|authorization)\s*[?:]/,
    );
    expect(source).not.toMatch(/\bpin\s*[?:]/);
    expect(source).toContain("buildPasswordChangedAuditMetadata");
    expect(source).toContain("buildPinChangedAuditMetadata");
    expect(source).toContain("buildManagerApprovalAuditMetadata");
  });

  it("report path sanitizes metadata and never selects credential user fields", () => {
    const source = read("lib/services/report-service.ts");
    expect(source).toContain("mapAuditLogForResponse");
    const block = source.match(
      /export async function getAuditLogReport[\s\S]*?\n\}/,
    )?.[0];
    expect(block).toBeTruthy();
    expect(block!).not.toContain("passwordHash");
    expect(block!).not.toMatch(/pin\s*:\s*true/);
    expect(block!).toContain("username: true");
    expect(block!).toContain("fullName: true");
  });

  it("central sanitizer is used and does not log raw input on failure", () => {
    const sanitizer = read("lib/security/audit-sanitizer.ts");
    expect(sanitizer).toContain("sanitizeAuditMetadata");
    expect(sanitizer).toContain("serializeSafeAuditMetadata");
    expect(sanitizer).not.toMatch(/console\.(log|info|debug|warn|error)/);
    const audit = read("lib/audit.ts");
    expect(audit).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it("does not persist error stacks from the sanitizer", () => {
    const sanitizer = read("lib/security/audit-sanitizer.ts");
    const errorFn = sanitizer.match(
      /export function sanitizeAuditError[\s\S]*?\n\}/,
    )?.[0];
    expect(errorFn).toBeTruthy();
    expect(errorFn!).not.toContain("stack:");
    expect(errorFn!).not.toContain(".stack");
  });

  it("high-risk services write audits through writeAuditRecord", () => {
    for (const file of [
      "lib/services/password-service.ts",
      "lib/services/manager-approval-service.ts",
      "lib/services/pin-security-service.ts",
      "lib/services/settings-service.ts",
      "lib/services/order-service.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("writeAuditRecord");
      expect(source).not.toMatch(/\.auditLog\.create\s*\(/);
    }
  });
});
