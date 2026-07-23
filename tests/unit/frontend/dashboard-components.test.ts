import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sectionSource = fs.readFileSync(
  path.resolve("components/dashboard/dashboard-section.tsx"),
  "utf8",
);
const metricSource = fs.readFileSync(
  path.resolve("components/dashboard/dashboard-metric-card.tsx"),
  "utf8",
);
const badgeSource = fs.readFileSync(
  path.resolve("components/dashboard/status-badge.tsx"),
  "utf8",
);

describe("dashboard presentational components", () => {
  it("associates each section with its heading", () => {
    expect(sectionSource).toContain("aria-labelledby=");
    expect(sectionSource).toContain("id={`dashboard-${title");
  });

  it("uses an h2 for section hierarchy", () => {
    expect(sectionSource).toContain("<h2");
    expect(sectionSource).not.toContain("<h1");
  });

  it("supports an optional section action", () => {
    expect(sectionSource).toContain("action?: React.ReactNode");
    expect(sectionSource).toContain("{action ?");
  });

  it("renders metric values supplied by the caller", () => {
    expect(metricSource).toContain("{value}");
    expect(metricSource).toContain("{detail}");
  });

  it("marks a loading metric busy", () => {
    expect(metricSource).toContain("aria-busy={loading || undefined}");
    expect(metricSource).toContain('role="status"');
  });

  it("gives each loading metric an accessible name", () => {
    expect(metricSource).toContain(
      "aria-label={`Loading ${label.toLowerCase()}`}",
    );
  });

  it("hides decorative metric icons", () => {
    expect(metricSource).toContain('<Icon aria-hidden="true"');
  });

  it("defines visual treatment for known operational statuses", () => {
    for (const status of ["Open", "PartiallyPaid", "Closed", "Void"]) {
      expect(badgeSource).toContain(`${status}:`);
    }
  });

  it("separates camel-case status labels for display", () => {
    expect(badgeSource).toContain(
      'status.replaceAll(/([a-z])([A-Z])/g, "$1 $2")',
    );
  });

  it("uses neutral styling for unknown statuses", () => {
    expect(badgeSource).toContain(
      '"bg-muted text-muted-foreground"',
    );
  });
});
