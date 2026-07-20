import { describe, expect, it } from "vitest";
import { validateBootstrapPin } from "../../../prisma/seed/bootstrap-credential-policy";

describe("bootstrap PIN policy", () => {
  it("allows an omitted PIN", () => {
    expect(validateBootstrapPin(undefined)).toEqual({ ok: true, value: null });
  });

  it("treats an empty example value as omitted", () => {
    expect(validateBootstrapPin("")).toEqual({ ok: true, value: null });
  });

  it.each(["123", "12345", "12a4", " 4826"])(
    "rejects values outside the four-digit backend format",
    (pin) => {
      expect(validateBootstrapPin(pin)).toMatchObject({
        ok: false,
        code: "BOOTSTRAP_ADMIN_PIN_INVALID_FORMAT",
      });
    },
  );

  it("rejects repeated digits", () => {
    expect(validateBootstrapPin("7777")).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PIN_REPEATED_DIGITS",
    });
  });

  it.each(["2345", "6543", "7890", "2109"])("rejects sequential digits", (pin) => {
    expect(validateBootstrapPin(pin)).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PIN_SEQUENTIAL",
    });
  });

  it("accepts a non-repeated, non-sequential four-digit PIN", () => {
    expect(validateBootstrapPin("4826")).toEqual({ ok: true, value: "4826" });
  });

  it("never echoes a rejected PIN in its error", () => {
    const pin = "9876";
    const result = validateBootstrapPin(pin);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(pin);
  });
});
