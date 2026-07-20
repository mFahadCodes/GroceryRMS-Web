import { describe, expect, it } from "vitest";

import { formatPKR, toPaisa, toPKR } from "../../lib/currency";

describe("currency helpers", () => {
  it("converts PKR to integer paisa", () => {
    expect(toPaisa(12.34)).toBe(1234n);
  });

  it("rounds fractional paisa to the nearest paisa", () => {
    expect(toPaisa(12.345)).toBe(1235n);
  });

  it("converts paisa back to PKR", () => {
    expect(toPKR(1234n)).toBe(12.34);
  });

  it("formats paisa with the default currency symbol", () => {
    expect(formatPKR(123456n)).toBe("Rs. 1,234.56");
  });

  it("supports a caller-provided currency symbol", () => {
    expect(formatPKR(500n, "PKR")).toBe("PKR 5.00");
  });
});
