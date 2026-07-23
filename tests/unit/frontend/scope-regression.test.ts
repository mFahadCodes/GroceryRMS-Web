import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultGitRunner,
  detectScopeMode,
  F1_SCOPE_BASELINE,
  F1_SCOPE_BRANCH,
  inspectStructuralScope,
  shouldEnforceF1ChangedPathScope,
} from "@/tests/unit/frontend/scope-regression-helpers";

const root = process.cwd();
const enforceF1ChangedPaths = shouldEnforceF1ChangedPathScope({
  runGit: defaultGitRunner,
});
const structuralViolations = inspectStructuralScope({ root });

/**
 * Historical changed-path inspection runs only for an explicit F1 scope
 * validation. Non-F1 branches keep permanent structural checks only.
 */
const changedFiles = enforceF1ChangedPaths
  ? detectScopeMode({
      baseline: F1_SCOPE_BASELINE,
      runGit: defaultGitRunner,
    }).changedFiles
  : [];

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function dashboardProductionSource() {
  return fs
    .readdirSync(path.join(root, "components/dashboard"))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => read(`components/dashboard/${file}`))
    .join("\n");
}

describe("F1 frontend scope regression", () => {
  describe("permanent structural repository invariants", () => {
    it("passes deterministic structural invariants on every branch", () => {
      expect(structuralViolations).toEqual([]);
    });

    it("uses GET-only dashboard helpers", () => {
      const source = read("components/dashboard/dashboard-data.ts");
      expect(source).not.toMatch(/\bmethod\s*:/);
      expect(source).not.toMatch(/\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
    });

    it("does not introduce a dashboard mutation hook", () => {
      expect(dashboardProductionSource()).not.toContain("useMutation");
    });

    it("does not add financial idempotency or approval behavior", () => {
      const source = dashboardProductionSource();
      expect(source).not.toContain("Idempotency-Key");
      expect(source).not.toContain("managerApprovalToken");
    });

    it("does not fabricate production dashboard figures", () => {
      const source = dashboardProductionSource();
      expect(source).not.toContain("Math.random");
      expect(source).not.toMatch(/\b(fake|fixture|mock)(Data|Orders|Metrics)\b/i);
    });

    it("does not request the mutating daily-summary report path", () => {
      expect(dashboardProductionSource()).not.toContain("/api/reports");
      expect(dashboardProductionSource()).not.toContain("totalRevenue");
    });

    it("contains no focused or skipped frontend tests", () => {
      const testRoot = path.join(root, "tests/unit/frontend");
      const source = fs
        .readdirSync(testRoot)
        .filter((file) => file.endsWith(".test.ts"))
        .map((file) => fs.readFileSync(path.join(testRoot, file), "utf8"))
        .join("\n");
      const focused = new RegExp("\\." + "only\\s*\\(");
      const skipped = new RegExp("\\." + "skip\\s*\\(");
      expect(source).not.toMatch(focused);
      expect(source).not.toMatch(skipped);
    });
  });

  describe("historical F1 changed-path enforcement", () => {
    it("records whether this run is an archived F1 scope validation", () => {
      // Non-F1 branches (including this P0-E branch) must not treat backend
      // diffs as F1 scope violations. F1 branch / override enables enforcement.
      expect(typeof enforceF1ChangedPaths).toBe("boolean");
      if (!enforceF1ChangedPaths) {
        expect(changedFiles).toEqual([]);
      }
    });

    it("does not change checkout or another POS workflow file", () => {
      if (!enforceF1ChangedPaths) return;
      expect(
        changedFiles.some(
          (file) =>
            file === "components/pos/CheckoutDialog.tsx" ||
            file.startsWith("components/pos/") ||
            file === "app/(dashboard)/pos/page.tsx",
        ),
      ).toBe(false);
    });

    it("does not change backend API routes", () => {
      if (!enforceF1ChangedPaths) return;
      expect(changedFiles.some((file) => file.startsWith("app/api/"))).toBe(
        false,
      );
    });

    it("does not change backend services or financial security helpers", () => {
      if (!enforceF1ChangedPaths) return;
      expect(
        changedFiles.some(
          (file) =>
            file.startsWith("lib/services/") ||
            file.startsWith("lib/security/"),
        ),
      ).toBe(false);
    });

    it("does not change Prisma schema or migrations", () => {
      if (!enforceF1ChangedPaths) return;
      expect(changedFiles.some((file) => file.startsWith("prisma/"))).toBe(
        false,
      );
    });

    it("does not change package manifests or lockfiles", () => {
      if (!enforceF1ChangedPaths) return;
      expect(
        changedFiles.some(
          (file) =>
            file === "package.json" ||
            file.endsWith("package-lock.json") ||
            file.endsWith("pnpm-lock.yaml") ||
            file.endsWith("yarn.lock"),
        ),
      ).toBe(false);
    });

    it("does not change Cursor-owned security or AI documentation", () => {
      if (!enforceF1ChangedPaths) return;
      expect(
        changedFiles.some(
          (file) =>
            file.startsWith("docs/security/") || file.startsWith("docs/ai/"),
        ),
      ).toBe(false);
    });

    it("does not modify the shared request client", () => {
      if (!enforceF1ChangedPaths) return;
      expect(changedFiles).not.toContain("lib/api/client.ts");
    });

    it("uses the archived F1 baseline constant when enforcement is designed", () => {
      expect(F1_SCOPE_BASELINE).toBe(
        "08cb3eeb3bbd7e3a2ac95275012b9cc814167605",
      );
      expect(F1_SCOPE_BRANCH).toBe("feat/f1-frontend-shell-dashboard");
    });
  });
});
