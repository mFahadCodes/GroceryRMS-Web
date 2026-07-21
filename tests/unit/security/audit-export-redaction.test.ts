import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeStoredAuditJson } from "../../../lib/security/audit-sanitizer";
import { AUDIT_REDACTED } from "../../../lib/security/audit-sanitizer";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("audit export redaction", () => {
  it("documents that no dedicated audit export route bypasses report redaction", () => {
    const maintenanceFiles = [
      "app/api/maintenance/export/route.ts",
      "app/api/maintenance/backup/route.ts",
      "app/api/orders/export/route.ts",
    ];
    for (const file of maintenanceFiles) {
      const source = read(file);
      expect(source).not.toMatch(/auditLog|AuditLog|getAuditLogReport/);
    }
    const reportRoute = read("app/api/reports/audit-log/route.ts");
    expect(reportRoute).toContain("getAuditLogReport");
    expect(reportRoute).toContain("paginated");
  });

  it("applies the same stored-json sanitizer export paths would use", () => {
    const exported = sanitizeStoredAuditJson(
      JSON.stringify({
        password: "export-secret",
        nested: { authorization: "Bearer x.y.z", ok: true },
      }),
    );
    expect(exported).toContain(AUDIT_REDACTED);
    expect(exported).toContain("true");
    expect(exported).not.toContain("export-secret");
    expect(exported).not.toContain("Bearer");
  });

  it("nested metadata cannot escape through stringification", () => {
    const once = sanitizeStoredAuditJson(
      JSON.stringify({ cookie: "session=1", note: "plain" }),
    );
    const twice = sanitizeStoredAuditJson(once);
    expect(twice).toBe(once);
    expect(twice).not.toContain("session=1");
  });
});
