import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type GitCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type GitRunner = (args: readonly string[]) => GitCommandResult;

export type ScopeDetection =
  | { mode: "full-history"; changedFiles: string[] }
  | { mode: "structural"; changedFiles: [] };

export const f1SourcePaths = [
  "app/page.tsx",
  "components/layout/dashboard-shell.tsx",
  "components/layout/navigation.ts",
  "components/layout/page-header.tsx",
  "components/layout/sidebar-navigation.tsx",
  "components/dashboard/dashboard-data.ts",
  "components/dashboard/dashboard-metric-card.tsx",
  "components/dashboard/dashboard-section.tsx",
  "components/dashboard/dashboard-states.tsx",
  "components/dashboard/dashboard-view.tsx",
  "components/dashboard/status-badge.tsx",
] as const;

export const defaultGitRunner: GitRunner = (args) => {
  const result = spawnSync("git", [...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
};

function assertGitSuccess(
  result: GitCommandResult,
  description: string,
): string {
  if (result.error) {
    throw new Error(`${description} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${description} failed with status ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function isMissingObject(result: GitCommandResult) {
  return (
    result.status === 128 &&
    /(?:not a valid object name|bad object|invalid object name)/i.test(
      result.stderr,
    )
  );
}

function splitPaths(output: string) {
  return output
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

export function detectScopeMode({
  baseline,
  runGit = defaultGitRunner,
}: {
  baseline: string;
  runGit?: GitRunner;
}): ScopeDetection {
  const baselineCheck = runGit(["cat-file", "-e", `${baseline}^{commit}`]);

  if (baselineCheck.error) {
    throw new Error(
      `Baseline availability check could not start: ${baselineCheck.error.message}`,
    );
  }

  if (baselineCheck.status === 0) {
    const diff = assertGitSuccess(
      runGit(["diff", "--name-only", `${baseline}...HEAD`]),
      "Approved-baseline branch diff",
    );
    const workingTree = assertGitSuccess(
      runGit(["diff", "--name-only", "HEAD"]),
      "Working-tree inspection",
    );
    const untracked = assertGitSuccess(
      runGit(["ls-files", "--others", "--exclude-standard"]),
      "Untracked-file inspection",
    );
    return {
      mode: "full-history",
      changedFiles: [
        ...new Set([
          ...splitPaths(diff),
          ...splitPaths(workingTree),
          ...splitPaths(untracked),
        ]),
      ],
    };
  }

  if (!isMissingObject(baselineCheck)) {
    throw new Error(
      `Unexpected baseline availability failure (status ${String(baselineCheck.status)}): ${baselineCheck.stderr.trim()}`,
    );
  }

  const shallowState = assertGitSuccess(
    runGit(["rev-parse", "--is-shallow-repository"]),
    "Shallow-repository detection",
  );

  if (shallowState === "true") {
    return { mode: "structural", changedFiles: [] };
  }
  if (shallowState === "false") {
    throw new Error(
      "Approved baseline is unavailable in a non-shallow repository",
    );
  }
  throw new Error(`Unexpected shallow-repository result: ${shallowState}`);
}

type StructuralInspectionOptions = {
  root?: string;
  sourcePaths?: readonly string[];
  readFile?: (absolutePath: string) => string;
};

export function inspectStructuralScope({
  root = process.cwd(),
  sourcePaths = f1SourcePaths,
  readFile = (absolutePath) => fs.readFileSync(absolutePath, "utf8"),
}: StructuralInspectionOptions = {}) {
  const sources = sourcePaths.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    let source: string;
    try {
      source = readFile(absolutePath);
    } catch (error) {
      throw new Error(
        `Unable to inspect expected F1 source path ${relativePath}: ${
          error instanceof Error ? error.message : "unknown read error"
        }`,
      );
    }
    return { relativePath, source };
  });

  const combined = sources
    .map(({ relativePath, source }) => `// ${relativePath}\n${source}`)
    .join("\n");
  const violations: string[] = [];

  const checks: Array<[string, RegExp]> = [
    [
      "financial workflow UI coupling",
      /\b(?:PartialPayment|Refund(?:Dialog|Form|Panel)|Return(?:Dialog|Form|Panel)|Void(?:Dialog|Form|Panel)|ManagerApproval)\b/,
    ],
    [
      "financial mutation behavior",
      /\buseMutation\b|\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
    ],
    [
      "backend route, service, or Prisma coupling",
      /from\s+["']@\/(?:app\/api|lib\/services|lib\/prisma)|from\s+["']@prisma|prisma\/(?:schema|migrations)/,
    ],
    [
      "global request interception",
      /globalThis\.fetch\s*=|window\.fetch\s*=|axios\.interceptors|fetchInterceptor/i,
    ],
    ["global idempotency injection", /Idempotency-Key/],
    [
      "fake production dashboard data",
      /\bMath\.random\b|\b(?:fake|fixture|mock)(?:Data|Orders|Metrics|Totals)\b/i,
    ],
    [
      "fabricated financial totals",
      /\b(?:totalRevenue|salesTotal|fakeTotal|fallbackTotal)\b/,
    ],
    [
      "P0-D financial idempotency coupling",
      /financial[-_ ]idempotency|financialAttempt|payloadFingerprint|idempotency-service|components\/pos\/CheckoutDialog/i,
    ],
  ];

  for (const [label, pattern] of checks) {
    if (pattern.test(combined)) violations.push(label);
  }

  return violations;
}
