import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const baseline = "63eb8d3a40ab6f427f72ac54c08e02adba01e535";
const root = process.cwd();
const trackedChanges = execFileSync(
  "git",
  ["diff", "--name-only", baseline],
  { cwd: root, encoding: "utf8" },
);
const untrackedChanges = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
);
const changedFiles = `${trackedChanges}\n${untrackedChanges}`
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

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

  it("does not change backend API routes", () => {
    expect(changedFiles.some((file) => file.startsWith("app/api/"))).toBe(
      false,
    );
  });

  it("does not change backend services or financial security helpers", () => {
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

  it("does not change Cursor-owned security or AI documentation", () => {
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
