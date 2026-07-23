import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const convertedRoutes = [
  "app/api/orders/[id]/discount/route.ts",
  "app/api/orders/[id]/void/route.ts",
] as const;

const issuanceSurfaces = [
  "app/api/auth/manager-approvals/route.ts",
  "lib/services/manager-approval-service.ts",
  "lib/security/manager-approval.ts",
] as const;

describe("manager approval source regression", () => {
  it("removes direct managerPin and managerUserId handling from converted order routes", () => {
    for (const file of convertedRoutes) {
      const source = read(file);
      expect(source).not.toContain("managerPin");
      expect(source).not.toContain("managerUserId");
      expect(source).not.toContain("resolveManagerApproval");
      expect(source).toContain("managerApprovalToken");
      expect(source).toContain("ManagerApprovalServiceError");
    }
  });

  it("does not call the legacy direct manager helper from converted routes", () => {
    for (const file of convertedRoutes) {
      expect(read(file)).not.toMatch(/from ["']@\/lib\/manager-pin["']/);
    }
  });

  it("keeps discount and void validators on approval tokens instead of manager PIN pairs", () => {
    const source = read("lib/validators/order.validators.ts");
    expect(source).toContain("managerApprovalToken");
    expect(source).not.toMatch(
      /applyOrderDiscountSchema[\s\S]*managerPin|voidOrderSchema[\s\S]*managerPin/,
    );
  });

  it("does not audit raw approval tokens or digests on issuance", () => {
    const source = read("lib/services/manager-approval-service.ts");
    expect(source).toContain("writeRequiredAudit");
    expect(source).not.toContain("writeAuditRecord");
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bwriteAuditRecord\b[^}]*\}\s*from/,
    );
    const issuedAudit = source.match(
      /action:\s*"MANAGER_APPROVAL_ISSUED"[\s\S]*?buildManagerApprovalAuditMetadata\([\s\S]*?\}\),/,
    )?.[0];
    const consumedAudit = source.match(
      /action:\s*"MANAGER_APPROVAL_CONSUMED"[\s\S]*?buildManagerApprovalAuditMetadata\([\s\S]*?\}\),/,
    )?.[0];
    expect(issuedAudit).toBeTruthy();
    expect(consumedAudit).toBeTruthy();
    for (const block of [issuedAudit!, consumedAudit!]) {
      expect(block).not.toContain("approvalToken");
      expect(block).not.toContain("tokenHash");
      expect(block).not.toContain("rawToken");
      expect(block).not.toContain("sessionId");
    }
    const builder = read("lib/security/audit-metadata.ts");
    expect(builder).toContain("buildManagerApprovalAuditMetadata");
    expect(builder).not.toMatch(
      /buildManagerApprovalAuditMetadata[\s\S]*?(approvalToken|tokenHash|rawToken|sessionId)/,
    );
  });

  it("does not log raw tokens, digests, or session identifiers from approval surfaces", () => {
    for (const file of [...issuanceSurfaces, ...convertedRoutes]) {
      const source = read(file);
      expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
      expect(source).not.toMatch(
        /JSON\.stringify\([^\)]*(approvalToken|tokenHash|rawToken)/i,
      );
    }
  });

  it("returns the raw token only from the successful issuance route response shape", () => {
    const route = read("app/api/auth/manager-approvals/route.ts");
    expect(route).toContain("approvalToken: issued.approvalToken");
    expect(route).toMatch(/return ok\(\s*\{[\s\S]*approvalToken: issued\.approvalToken/);
    const discount = read("app/api/orders/[id]/discount/route.ts");
    expect(discount).toContain("approvalToken: parsed.data.managerApprovalToken");
    expect(discount).not.toMatch(/ok\([\s\S]*approvalToken/);
    expect(discount).not.toContain("issued.approvalToken");
    // Void validates the token only inside original execute (after replay resolution).
    const voidRoute = read("app/api/orders/[id]/void/route.ts");
    expect(voidRoute).toContain("approvalToken: tokenParsed.data");
    expect(voidRoute).not.toMatch(/ok\([\s\S]*approvalToken/);
    expect(voidRoute).not.toContain("issued.approvalToken");
  });

  it("stores digest fields rather than raw tokens in the Prisma grant model", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("tokenHash");
    expect(schema).not.toMatch(/model ManagerApprovalGrant[\s\S]*token\s+String/);
  });

  it("does not expose grant digests from discount or void route handlers", () => {
    for (const file of convertedRoutes) {
      const source = read(file);
      expect(source).not.toContain("tokenHash");
      expect(source).not.toContain("managerApprovalGrant");
    }
  });
});
