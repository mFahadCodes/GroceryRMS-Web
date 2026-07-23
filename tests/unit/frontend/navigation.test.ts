import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/api/permissions";
import {
  getRouteContext,
  getVisibleNavigation,
  hasSessionPermission,
  isNavigationItemActive,
  navigationItems,
} from "@/components/layout/navigation";

describe("application navigation", () => {
  it("uses only routes that already exist in the application", () => {
    expect(navigationItems.map((item) => item.href)).toEqual([
      "/",
      "/pos",
      "/catalog",
      "/inventory",
      "/orders",
      "/reports",
    ]);
  });

  it("keeps the dashboard available without a module permission", () => {
    expect(getVisibleNavigation([]).map((item) => item.label)).toEqual([
      "Dashboard",
    ]);
  });

  it("shows POS and orders for order-processing permission", () => {
    const labels = getVisibleNavigation([
      `${PERMS.CREATE_ORDERS}:1`,
    ]).map((item) => item.label);
    expect(labels).toEqual(["Dashboard", "POS", "Orders"]);
  });

  it("hides a permission at access level zero", () => {
    const labels = getVisibleNavigation([
      `${PERMS.VIEW_REPORTS}:0`,
    ]).map((item) => item.label);
    expect(labels).not.toContain("Reports");
  });

  it("matches session permission names case-insensitively", () => {
    expect(
      hasSessionPermission(
        [`${PERMS.VIEW_REPORTS.toUpperCase()}:3`],
        PERMS.VIEW_REPORTS,
        2,
      ),
    ).toBe(true);
  });

  it("uses the final colon as the access-level delimiter", () => {
    expect(hasSessionPermission(["Custom:Permission:4"], "Custom:Permission", 4))
      .toBe(true);
  });

  it("shows catalog for the exact catalog permission", () => {
    expect(
      getVisibleNavigation([`${PERMS.VIEW_CATALOG}:1`]).map(
        (item) => item.label,
      ),
    ).toContain("Catalog");
  });

  it("shows inventory for the exact inventory permission", () => {
    expect(
      getVisibleNavigation([`${PERMS.MANAGE_INVENTORY}:1`]).map(
        (item) => item.label,
      ),
    ).toContain("Inventory");
  });

  it("shows reports for the exact reports permission", () => {
    expect(
      getVisibleNavigation([`${PERMS.VIEW_REPORTS}:1`]).map(
        (item) => item.label,
      ),
    ).toContain("Reports");
  });

  it("matches the dashboard only at the root", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/orders", "/")).toBe(false);
  });

  it("matches an exact section route", () => {
    expect(isNavigationItemActive("/inventory", "/inventory")).toBe(true);
  });

  it("matches a nested section route", () => {
    expect(isNavigationItemActive("/orders/42", "/orders")).toBe(true);
  });

  it("does not match a route with a shared prefix", () => {
    expect(isNavigationItemActive("/order-settings", "/orders")).toBe(false);
  });

  it("derives the header context from a nested route", () => {
    expect(getRouteContext("/catalog/seasonal")).toEqual({
      title: "Catalog",
      description: "Products and categories",
    });
  });

  it("falls back to dashboard context for unknown paths", () => {
    expect(getRouteContext("/unknown")).toEqual({
      title: "Dashboard",
      description: "Operational overview",
    });
  });
});
