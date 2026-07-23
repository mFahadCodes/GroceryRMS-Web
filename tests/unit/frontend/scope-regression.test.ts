import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultGitRunner,
  detectScopeMode,
  f1SourcePaths,
  inspectStructuralScope,
} from "@/tests/unit/frontend/scope-regression-helpers";

/** Approved integrated main tip (post-F1). Scope checks are relative to this. */
const baseline = "83db9fd824c6e4ccf580a0b021b50774ea9af62e";
const root = process.cwd();
const scope = detectScopeMode({ baseline, runGit: defaultGitRunner });
const changedFiles = scope.changedFiles;
const structuralViolations = inspectStructuralScope({ root });

const f1OwnedChanged = changedFiles.some(
  (file) =>
    (f1SourcePaths as readonly string[]).includes(file) ||
    file.startsWith("components/dashboard/") ||
    file.startsWith("components/layout/") ||
    file === "app/page.tsx" ||
    file.startsWith("docs/frontend/"),
);

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
  it("passes deterministic structural invariants in every Git mode", () => {
    expect(structuralViolations).toEqual([]);
  });

  it("does not change checkout or another POS workflow file", () => {
    expect(
      changedFiles.some(
        (file) =>
          file === "components/pos/CheckoutDialog.tsx" ||
          file.startsWith("components/pos/") ||
          file === "app/(dashboard)/pos/page.tsx",
      ),
    ).toBe(false);
  });

  it("does not change backend API routes when F1-owned sources change", () => {
    if (!f1OwnedChanged) return;
    expect(changedFiles.some((file) => file.startsWith("app/api/"))).toBe(
      false,
    );
  });

  it("does not change backend services or financial security helpers when F1-owned sources change", () => {
    if (!f1OwnedChanged) return;
    expect(
      changedFiles.some(
        (file) =>
          file.startsWith("lib/services/") ||
          file.startsWith("lib/security/"),
      ),
    ).toBe(false);
  });

  it("does not change Prisma schema or migrations", () => {
    expect(changedFiles.some((file) => file.startsWith("prisma/"))).toBe(false);
  });

  it("does not change package manifests or lockfiles", () => {
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

  it("does not change Cursor-owned security or AI documentation when F1-owned sources change", () => {
    if (!f1OwnedChanged) return;
    expect(
      changedFiles.some(
        (file) =>
          file.startsWith("docs/security/") || file.startsWith("docs/ai/"),
      ),
    ).toBe(false);
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

  it("does not modify the shared request client", () => {
    expect(changedFiles).not.toContain("lib/api/client.ts");
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
