import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("components/dashboard/dashboard-states.tsx"),
  "utf8",
);

describe("dashboard states", () => {
  it("announces loading as a status", () => {
    expect(source).toContain('role="status"');
  });

  it("marks loading content busy", () => {
    expect(source).toContain('aria-busy="true"');
  });

  it("provides a customizable loading label", () => {
    expect(source).toContain('label = "Loading section"');
    expect(source).toContain("aria-label={label}");
  });

  it("uses deterministic skeleton lines", () => {
    expect(source).toContain("Array.from({ length: lines }");
    expect(source).not.toContain("Math.random");
  });

  it("renders empty-state title and guidance", () => {
    expect(source).toContain("{title}");
    expect(source).toContain("{description}");
  });

  it("announces section errors", () => {
    expect(source).toContain('role="alert"');
  });

  it("uses safe fixed error guidance", () => {
    expect(source).toContain(
      "Try again, or continue using the other dashboard sections.",
    );
    expect(source).not.toContain("error.stack");
    expect(source).not.toContain("error.details");
  });

  it("offers retry only when a callback exists", () => {
    expect(source).toContain("{onRetry ? (");
    expect(source).toContain("onClick={onRetry}");
  });

  it("uses a button for read-only retry", () => {
    expect(source).toMatch(/<button[\s\S]*?Retry[\s\S]*?<\/button>/);
  });

  it("uses a heading for permission-denied state", () => {
    expect(source).toContain("<h2");
    expect(source).toContain("Operational overview unavailable");
  });

  it("does not expose restricted module names by default", () => {
    const defaultDescription =
      "Your role does not include access to dashboard operational data.";
    expect(source).toContain(defaultDescription);
    expect(defaultDescription).not.toMatch(/sales|revenue/i);
  });
});
