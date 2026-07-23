import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("components/layout/page-header.tsx"),
  "utf8",
);

describe("page header and breadcrumbs", () => {
  it("uses one primary heading in the page-header component", () => {
    expect(source.match(/<h1\b/g)).toHaveLength(1);
  });

  it("renders the supplied page title in the primary heading", () => {
    expect(source).toContain("{title}");
    expect(source).toMatch(/<h1[\s\S]*?\{title\}[\s\S]*?<\/h1>/);
  });

  it("supports optional supporting context", () => {
    expect(source).toContain("{description ? (");
    expect(source).toContain("{description}");
  });

  it("omits breadcrumbs with fewer than two items", () => {
    expect(source).toContain("if (items.length < 2) return null");
  });

  it("labels the breadcrumb navigation", () => {
    expect(source).toContain('<nav aria-label="Breadcrumb">');
  });

  it("marks only the final breadcrumb current", () => {
    expect(source).toContain("const current = index === items.length - 1");
    expect(source).toContain('aria-current={current ? "page" : undefined}');
  });

  it("links only non-current breadcrumb items", () => {
    expect(source).toContain("item.href && !current");
    expect(source).toContain("<Link");
  });

  it("supports a separate actions slot", () => {
    expect(source).toContain("actions?: React.ReactNode");
    expect(source).toContain("{actions ?");
  });
});
