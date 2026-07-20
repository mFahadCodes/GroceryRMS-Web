import { describe, expect, it } from "vitest";
import { validatePasswordPolicy } from "../../../lib/security/password-policy";

const username = "rotation-user";
const valid = "a secure test passphrase";

describe("shared runtime password policy", () => {
  it("accepts a valid long passphrase", () => {
    expect(validatePasswordPolicy(valid, username)).toEqual({ ok: true, value: valid });
  });
  it("preserves leading and trailing spaces", () => {
    const password = `  ${valid}  `;
    expect(validatePasswordPolicy(password, username)).toEqual({ ok: true, value: password });
  });
  it.each([undefined, "", " ".repeat(20)])("rejects a missing or blank password", (password) => {
    expect(validatePasswordPolicy(password, username)).toMatchObject({ ok: false, code: "PASSWORD_REQUIRED" });
  });
  it("rejects fewer than fifteen characters", () => {
    expect(validatePasswordPolicy("short phrase", username)).toMatchObject({ ok: false, code: "PASSWORD_TOO_SHORT" });
  });
  it("accepts exactly seventy-two UTF-8 bytes", () => {
    expect(validatePasswordPolicy("z".repeat(72), username).ok).toBe(true);
  });
  it("rejects more than seventy-two UTF-8 bytes", () => {
    expect(validatePasswordPolicy("z".repeat(73), username)).toMatchObject({ ok: false, code: "PASSWORD_TOO_LONG" });
  });
  it("counts Unicode UTF-8 bytes", () => {
    expect(validatePasswordPolicy("é".repeat(37), username)).toMatchObject({ ok: false, code: "PASSWORD_TOO_LONG" });
  });
  it.each(["welcome00000000", "change-me-00000000", "administrator000"])("rejects placeholder-style values", (password) => {
    expect(validatePasswordPolicy(password, username)).toMatchObject({ ok: false, code: "PASSWORD_PLACEHOLDER" });
  });
  it("rejects a username-equivalent password", () => {
    const longUsername = "rotation-user-name";
    expect(validatePasswordPolicy(longUsername, longUsername)).toMatchObject({ ok: false, code: "PASSWORD_MATCHES_USERNAME" });
  });
  it("rejects trivial username variations", () => {
    expect(validatePasswordPolicy("rotation-user-0000", username)).toMatchObject({ ok: false, code: "PASSWORD_TRIVIAL_USERNAME_VARIATION" });
  });
  it("never includes the rejected value in errors", () => {
    const password = "z".repeat(73);
    expect(JSON.stringify(validatePasswordPolicy(password, username))).not.toContain(password);
  });
});
