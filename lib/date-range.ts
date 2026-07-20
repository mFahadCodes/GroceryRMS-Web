const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyString(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Local calendar YYYY-MM-DD (never UTC-shifted). */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Local midnight → next local midnight for a YYYY-MM-DD string.
 * Avoids `new Date("YYYY-MM-DD")` which is parsed as UTC.
 */
export function localDayRangeFromString(dateStr: string): {
  start: Date;
  end: Date;
} {
  if (!isDateOnlyString(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

/** Inclusive local range across from..to (both YYYY-MM-DD). End is exclusive next midnight. */
export function localDayRangeFromTo(
  fromStr: string,
  toStr: string,
): { start: Date; end: Date } {
  const { start } = localDayRangeFromString(fromStr);
  const { end } = localDayRangeFromString(toStr);
  return { start, end };
}
