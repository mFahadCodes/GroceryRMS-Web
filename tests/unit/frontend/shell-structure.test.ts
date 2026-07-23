import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const shellSource = fs.readFileSync(
  path.resolve("components/layout/dashboard-shell.tsx"),
  "utf8",
);
const navigationSource = fs.readFileSync(
  path.resolve("components/layout/sidebar-navigation.tsx"),
  "utf8",
);

describe("authenticated shell structure", () => {
  it("renders a labeled primary navigation landmark", () => {
    expect(navigationSource).toContain("<nav aria-label={label}");
    expect(shellSource).toContain('label="Primary navigation"');
  });

  it("marks the active route with aria-current", () => {
    expect(navigationSource).toContain(
      'aria-current={active ? "page" : undefined}',
    );
  });

  it("provides a skip link to the main landmark", () => {
    expect(shellSource).toContain('href="#main-content"');
    expect(shellSource).toContain('id="main-content"');
  });

  it("makes the main landmark programmatically focusable", () => {
    expect(shellSource).toContain("tabIndex={-1}");
  });

  it("gives the mobile trigger an accessible name and state", () => {
    expect(shellSource).toContain('aria-label="Open navigation menu"');
    expect(shellSource).toContain("aria-expanded={mobileOpen}");
    expect(shellSource).toContain('aria-controls="mobile-navigation"');
  });

  it("uses a modal dialog for temporary mobile navigation", () => {
    expect(shellSource).toContain('role="dialog"');
    expect(shellSource).toContain('aria-modal="true"');
  });

  it("closes temporary navigation on Escape", () => {
    expect(shellSource).toContain('event.key === "Escape"');
    expect(shellSource).toContain("closeMobileNavigation()");
  });

  it("restores focus to the mobile trigger", () => {
    expect(shellSource).toContain("menuTriggerRef.current?.focus()");
  });

  it("keeps Tab focus inside the open modal drawer", () => {
    expect(shellSource).toContain('event.key === "Tab"');
    expect(shellSource).toContain("drawerPanelRef.current?.querySelectorAll");
    expect(shellSource).toContain("last.focus()");
    expect(shellSource).toContain("first.focus()");
  });

  it("prevents background scrolling while the drawer is open", () => {
    expect(shellSource).toContain('document.body.style.overflow = "hidden"');
    expect(shellSource).toContain(
      "document.body.style.overflow = previousOverflow",
    );
  });

  it("removes keyboard listeners during cleanup", () => {
    expect(shellSource).toContain(
      'document.removeEventListener("keydown", handleKeyDown)',
    );
  });

  it("closes the drawer after a navigation selection", () => {
    expect(shellSource).toContain(
      "onNavigate={() => closeMobileNavigation(false)}",
    );
  });

  it("uses distinct desktop and mobile navigation labels", () => {
    expect(shellSource).toContain('label="Primary navigation"');
    expect(shellSource).toContain('label="Mobile navigation"');
  });

  it("includes desktop, tablet, and mobile responsive classes", () => {
    expect(shellSource).toContain("md:flex");
    expect(shellSource).toContain("xl:w-64");
    expect(shellSource).toContain("md:hidden");
  });

  it("includes a single main landmark in the shell", () => {
    expect(shellSource.match(/<main\b/g)).toHaveLength(1);
  });
});
