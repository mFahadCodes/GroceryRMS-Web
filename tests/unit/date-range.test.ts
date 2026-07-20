import { describe, expect, it } from "vitest";

import {
  isDateOnlyString,
  localDayRangeFromString,
  localDayRangeFromTo,
  toLocalDateString,
} from "../../lib/date-range";

describe("date range helpers", () => {
  it("recognizes the required date-only shape", () => {
    expect(isDateOnlyString("2026-07-20")).toBe(true);
    expect(isDateOnlyString("20-07-2026")).toBe(false);
  });

  it("formats a Date using local calendar fields", () => {
    const date = new Date(2024, 1, 29, 23, 45, 0, 0);

    expect(toLocalDateString(date)).toBe("2024-02-29");
  });

  it("creates a local-midnight half-open day range", () => {
    const { start, end } = localDayRangeFromString("2026-07-20");

    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
    ]).toEqual([2026, 6, 20, 0]);
    expect([
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      end.getHours(),
    ]).toEqual([2026, 6, 21, 0]);
  });

  it("rolls a year-end day range into the next year", () => {
    const { end } = localDayRangeFromString("2025-12-31");

    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([
      2026, 0, 1,
    ]);
  });

  it("rejects values that are not date-only strings", () => {
    expect(() => localDayRangeFromString("2026-7-20")).toThrow(
      "Invalid date string",
    );
  });

  it("uses the next midnight after the inclusive end date", () => {
    const { start, end } = localDayRangeFromTo("2026-07-20", "2026-07-22");

    expect([start.getDate(), end.getDate()]).toEqual([20, 23]);
  });
});
