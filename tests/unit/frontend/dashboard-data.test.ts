import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { PERMS } from "@/lib/api/permissions";
import {
  formatBackendMoney,
  formatDashboardDateTime,
  formatShiftDuration,
  getDashboardAccess,
  getTerminalLabel,
  hasAnyDashboardAccess,
  isPermissionDenied,
  type CurrentShift,
} from "@/components/dashboard/dashboard-data";

const shift: CurrentShift = {
  id: 1,
  startedAt: "2026-07-23T08:00:00.000Z",
  terminal: { id: 2, name: "Register 2", location: "Front" },
};

describe("dashboard data contracts", () => {
  it("maps order permission without granting other modules", () => {
    expect(getDashboardAccess([`${PERMS.CREATE_ORDERS}:1`])).toEqual({
      orders: true,
      inventory: false,
      shift: false,
    });
  });

  it("maps inventory permission", () => {
    expect(
      getDashboardAccess([`${PERMS.MANAGE_INVENTORY}:1`]).inventory,
    ).toBe(true);
  });

  it("maps shift permission", () => {
    expect(
      getDashboardAccess([`${PERMS.OPEN_CLOSE_SHIFT}:1`]).shift,
    ).toBe(true);
  });

  it("does not accept access level zero", () => {
    expect(
      getDashboardAccess([`${PERMS.CREATE_ORDERS}:0`]).orders,
    ).toBe(false);
  });

  it("detects when at least one section is available", () => {
    expect(
      hasAnyDashboardAccess({ orders: false, inventory: true, shift: false }),
    ).toBe(true);
  });

  it("detects a fully restricted dashboard", () => {
    expect(
      hasAnyDashboardAccess({
        orders: false,
        inventory: false,
        shift: false,
      }),
    ).toBe(false);
  });

  it("classifies only HTTP 403 as permission denied", () => {
    expect(isPermissionDenied(new ApiError("Forbidden", 403))).toBe(true);
    expect(isPermissionDenied(new ApiError("Offline", 503))).toBe(false);
    expect(isPermissionDenied(new Error("Forbidden"))).toBe(false);
  });

  it("formats a shift shorter than one hour", () => {
    expect(
      formatShiftDuration(
        "2026-07-23T08:00:00.000Z",
        new Date("2026-07-23T08:42:00.000Z"),
      ),
    ).toBe("42m");
  });

  it("formats a multi-hour shift", () => {
    expect(
      formatShiftDuration(
        "2026-07-23T08:00:00.000Z",
        new Date("2026-07-23T10:07:00.000Z"),
      ),
    ).toBe("2h 7m");
  });

  it("does not produce a negative shift duration", () => {
    expect(
      formatShiftDuration(
        "2026-07-23T09:00:00.000Z",
        new Date("2026-07-23T08:00:00.000Z"),
      ),
    ).toBe("0m");
  });

  it("combines terminal name and location", () => {
    expect(getTerminalLabel(shift)).toBe("Register 2 · Front");
  });

  it("handles a terminal without a location", () => {
    expect(
      getTerminalLabel({
        ...shift,
        terminal: { id: 2, name: "Register 2", location: null },
      }),
    ).toBe("Register 2");
  });

  it("handles an unassigned terminal", () => {
    expect(getTerminalLabel({ ...shift, terminal: null })).toBe(
      "No terminal assigned",
    );
  });

  it("renders backend paisa without deriving another total", () => {
    expect(formatBackendMoney("12345")).toMatch(/123\.45/);
  });

  it("does not fabricate a missing money value", () => {
    expect(formatBackendMoney(undefined)).toBe("Unavailable");
    expect(formatBackendMoney("not-a-number")).toBe("Unavailable");
  });

  it("safely handles a missing timestamp", () => {
    expect(formatDashboardDateTime(undefined)).toBe("Time unavailable");
    expect(formatDashboardDateTime("invalid")).toBe("Time unavailable");
  });
});
