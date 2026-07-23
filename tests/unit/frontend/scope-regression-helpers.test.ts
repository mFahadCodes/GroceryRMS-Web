import { describe, expect, it } from "vitest";
import {
  detectScopeMode,
  F1_SCOPE_BASELINE,
  F1_SCOPE_BRANCH,
  F1_SCOPE_ENV_OVERRIDE,
  inspectStructuralScope,
  resolveCurrentBranchName,
  shouldEnforceF1ChangedPathScope,
  type GitCommandResult,
  type GitRunner,
} from "@/tests/unit/frontend/scope-regression-helpers";

function result(
  status: number,
  stdout = "",
  stderr = "",
): GitCommandResult {
  return { status, stdout, stderr };
}

function sequenceRunner(
  expected: Array<{
    args: readonly string[];
    result: GitCommandResult;
  }>,
): GitRunner {
  let index = 0;
  return (args) => {
    const next = expected[index++];
    if (!next) throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    expect(args).toEqual(next.args);
    return next.result;
  };
}

describe("scope-regression branch and enforcement detection", () => {
  it("enables historical F1 changed-path enforcement for the exact F1 branch", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: {},
        branchName: F1_SCOPE_BRANCH,
      }),
    ).toBe(true);
  });

  it("enables enforcement when GITHUB_HEAD_REF is the F1 branch", () => {
    const runGit: GitRunner = () => {
      throw new Error("local git must not be consulted when HEAD_REF is set");
    };
    expect(
      shouldEnforceF1ChangedPathScope({
        env: { GITHUB_HEAD_REF: F1_SCOPE_BRANCH },
        runGit,
      }),
    ).toBe(true);
    expect(
      resolveCurrentBranchName({
        env: { GITHUB_HEAD_REF: F1_SCOPE_BRANCH },
        runGit,
      }),
    ).toBe(F1_SCOPE_BRANCH);
  });

  it("enables enforcement for a local F1 branch via git branch --show-current", () => {
    const runGit = sequenceRunner([
      {
        args: ["branch", "--show-current"],
        result: result(0, `${F1_SCOPE_BRANCH}\n`),
      },
    ]);
    expect(shouldEnforceF1ChangedPathScope({ env: {}, runGit })).toBe(true);
  });

  it("enables enforcement via the explicit environment override", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: { [F1_SCOPE_ENV_OVERRIDE]: "1" },
        branchName: "main",
      }),
    ).toBe(true);
  });

  it("disables historical F1 changed-path enforcement on main", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: {},
        branchName: "main",
      }),
    ).toBe(false);
  });

  it("disables historical F1 changed-path enforcement on a backend inventory branch", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: {},
        branchName: "fix/inv1-purchase-order-receive-concurrency",
      }),
    ).toBe(false);
  });

  it("disables historical F1 changed-path enforcement on a security branch", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: {},
        branchName: "fix/p0e-discount-idempotency-concurrency",
      }),
    ).toBe(false);
  });

  it("prefers GITHUB_HEAD_REF over GITHUB_REF_NAME and local git", () => {
    const runGit: GitRunner = () => {
      throw new Error("local git must not run when HEAD_REF is present");
    };
    expect(
      resolveCurrentBranchName({
        env: {
          GITHUB_HEAD_REF: F1_SCOPE_BRANCH,
          GITHUB_REF_NAME: "123/merge",
          GITHUB_REF: "refs/pull/123/merge",
        },
        runGit,
      }),
    ).toBe(F1_SCOPE_BRANCH);
  });

  it("uses GITHUB_REF_NAME when GITHUB_REF is a branch ref", () => {
    const runGit: GitRunner = () => {
      throw new Error("local git must not run when branch REF_NAME is present");
    };
    expect(
      resolveCurrentBranchName({
        env: {
          GITHUB_REF_NAME: "fix/p0e-discount-idempotency-concurrency",
          GITHUB_REF: "refs/heads/fix/p0e-discount-idempotency-concurrency",
        },
        runGit,
      }),
    ).toBe("fix/p0e-discount-idempotency-concurrency");
  });

  it("fails closed when local branch resolution returns an unexpected Git error", () => {
    const runGit: GitRunner = () =>
      result(128, "", "fatal: not a git repository");
    expect(() => resolveCurrentBranchName({ env: {}, runGit })).toThrow(
      "Current branch resolution failed",
    );
  });
});

describe("scope-regression mode detection", () => {
  it("selects full-history mode when the approved baseline is available", () => {
    const baseline = F1_SCOPE_BASELINE;
    const runGit = sequenceRunner([
      {
        args: ["cat-file", "-e", `${baseline}^{commit}`],
        result: result(0),
      },
      {
        args: ["diff", "--name-only", `${baseline}...HEAD`],
        result: result(0, "app/page.tsx\ncomponents/dashboard/dashboard-view.tsx\n"),
      },
      {
        args: ["diff", "--name-only", "HEAD"],
        result: result(0, "tests/unit/frontend/scope-regression.test.ts\n"),
      },
      {
        args: ["ls-files", "--others", "--exclude-standard"],
        result: result(0),
      },
    ]);

    expect(detectScopeMode({ baseline, runGit })).toEqual({
      mode: "full-history",
      changedFiles: [
        "app/page.tsx",
        "components/dashboard/dashboard-view.tsx",
        "tests/unit/frontend/scope-regression.test.ts",
      ],
    });
  });

  it("selects structural mode only for a missing baseline in a shallow clone", () => {
    const baseline = F1_SCOPE_BASELINE;
    const runGit = sequenceRunner([
      {
        args: ["cat-file", "-e", `${baseline}^{commit}`],
        result: result(128, "", "fatal: Not a valid object name"),
      },
      {
        args: ["rev-parse", "--is-shallow-repository"],
        result: result(0, "true\n"),
      },
    ]);

    expect(detectScopeMode({ baseline, runGit })).toEqual({
      mode: "structural",
      changedFiles: [],
    });
  });

  it("fails when the baseline is missing from a non-shallow repository", () => {
    const runGit = sequenceRunner([
      {
        args: ["cat-file", "-e", `${F1_SCOPE_BASELINE}^{commit}`],
        result: result(128, "", "fatal: bad object"),
      },
      {
        args: ["rev-parse", "--is-shallow-repository"],
        result: result(0, "false\n"),
      },
    ]);

    expect(() =>
      detectScopeMode({ baseline: F1_SCOPE_BASELINE, runGit }),
    ).toThrow("Approved baseline is unavailable in a non-shallow repository");
  });

  it("fails closed on an unexpected baseline command error", () => {
    const runGit: GitRunner = () =>
      result(1, "", "fatal: repository ownership is unsafe");
    expect(() =>
      detectScopeMode({ baseline: F1_SCOPE_BASELINE, runGit }),
    ).toThrow("Unexpected baseline availability failure");
  });

  it("fails closed when shallow-state detection fails", () => {
    const runGit = sequenceRunner([
      {
        args: ["cat-file", "-e", `${F1_SCOPE_BASELINE}^{commit}`],
        result: result(128, "", "fatal: bad object"),
      },
      {
        args: ["rev-parse", "--is-shallow-repository"],
        result: result(2, "", "fatal: cannot inspect repository"),
      },
    ]);

    expect(() =>
      detectScopeMode({ baseline: F1_SCOPE_BASELINE, runGit }),
    ).toThrow("Shallow-repository detection failed");
  });

  it("detects representative forbidden behavior in structural mode", () => {
    const violations = inspectStructuralScope({
      root: "unused",
      sourcePaths: ["components/dashboard/dashboard-data.ts"],
      readFile: () =>
        'import { useMutation } from "@tanstack/react-query";\nconst key = "Idempotency-Key";',
    });
    expect(violations).toContain("financial mutation behavior");
    expect(violations).toContain("global idempotency injection");
  });

  it("fails closed when an expected structural source cannot be inspected", () => {
    expect(() =>
      inspectStructuralScope({
        root: "unused",
        sourcePaths: ["components/dashboard/missing.ts"],
        readFile: () => {
          throw new Error("missing");
        },
      }),
    ).toThrow(
      "Unable to inspect expected F1 source path components/dashboard/missing.ts",
    );
  });

  it("keeps permanent structural checks available without F1 changed-path mode", () => {
    expect(
      shouldEnforceF1ChangedPathScope({
        env: {},
        branchName: "fix/inv1-purchase-order-receive-concurrency",
      }),
    ).toBe(false);
    const violations = inspectStructuralScope({
      root: "unused",
      sourcePaths: ["components/dashboard/dashboard-view.tsx"],
      readFile: () => "export function DashboardView() { return null; }",
    });
    expect(violations).toEqual([]);
  });
});
