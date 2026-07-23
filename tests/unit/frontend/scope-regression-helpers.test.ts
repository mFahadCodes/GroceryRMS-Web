import { describe, expect, it } from "vitest";
import {
  detectScopeMode,
  inspectStructuralScope,
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

describe("scope-regression mode detection", () => {
  it("selects full-history mode when the approved baseline is available", () => {
    const baseline = "approved-baseline";
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
    const baseline = "approved-baseline";
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
        args: ["cat-file", "-e", "baseline^{commit}"],
        result: result(128, "", "fatal: bad object"),
      },
      {
        args: ["rev-parse", "--is-shallow-repository"],
        result: result(0, "false\n"),
      },
    ]);

    expect(() => detectScopeMode({ baseline: "baseline", runGit })).toThrow(
      "Approved baseline is unavailable in a non-shallow repository",
    );
  });

  it("fails closed on an unexpected baseline command error", () => {
    const runGit: GitRunner = () =>
      result(1, "", "fatal: repository ownership is unsafe");
    expect(() => detectScopeMode({ baseline: "baseline", runGit })).toThrow(
      "Unexpected baseline availability failure",
    );
  });

  it("fails closed when shallow-state detection fails", () => {
    const runGit = sequenceRunner([
      {
        args: ["cat-file", "-e", "baseline^{commit}"],
        result: result(128, "", "fatal: bad object"),
      },
      {
        args: ["rev-parse", "--is-shallow-repository"],
        result: result(2, "", "fatal: cannot inspect repository"),
      },
    ]);

    expect(() => detectScopeMode({ baseline: "baseline", runGit })).toThrow(
      "Shallow-repository detection failed",
    );
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
});
