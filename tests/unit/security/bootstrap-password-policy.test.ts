import { describe, expect, it } from "vitest";
import {
  validateBootstrapPassword,
  validateBootstrapUsername,
} from "../../../prisma/seed/bootstrap-credential-policy";

const strongPassword = (label = "valid") =>
  `test-only ${label} ${"phrase ".repeat(3)}`;

describe("bootstrap username policy", () => {
  it("requires a username", () => {
    expect(validateBootstrapUsername(undefined)).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_USERNAME_REQUIRED",
    });
  });

  it("normalizes surrounding username whitespace", () => {
    expect(validateBootstrapUsername("  primary-admin  ")).toEqual({
      ok: true,
      value: "primary-admin",
    });
  });

  it("rejects an over-limit username", () => {
    expect(validateBootstrapUsername("u".repeat(65))).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_USERNAME_TOO_LONG",
    });
  });
});
describe("bootstrap password policy", () => {
  it("requires a password", () => {
    expect(validateBootstrapPassword(undefined, "primary-admin")).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED",
    });
  });

  it("rejects a whitespace-only password", () => {
    expect(
      validateBootstrapPassword(" ".repeat(20), "primary-admin"),
    ).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED",
    });
  });

  it("rejects a password shorter than 15 characters", () => {
    expect(validateBootstrapPassword("brief phrase", "primary-admin")).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_TOO_SHORT",
    });
  });

  it.each([
    "welcome".concat("0".repeat(8)),
    "administrator".concat("0".repeat(3)),
    "change-me".concat("0".repeat(8)),
  ])("rejects placeholder-style values", (password) => {
    expect(validateBootstrapPassword(password, "primary-admin")).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_PLACEHOLDER",
    });
  });

  it("rejects a password equal to a sufficiently long username", () => {
    const username = "primary-administrator";
    expect(validateBootstrapPassword(username, username)).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_MATCHES_USERNAME",
    });
  });

  it("rejects a trivial username variation", () => {
    expect(
      validateBootstrapPassword("primary-admin-000000", "primary-admin"),
    ).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_TRIVIAL_USERNAME_VARIATION",
    });
  });

  it("permits spaces and preserves a valid passphrase exactly", () => {
    const password = `  ${strongPassword("spaces")}`;
    expect(validateBootstrapPassword(password, "primary-admin")).toEqual({
      ok: true,
      value: password,
    });
  });

  it("accepts a password at the bcrypt byte limit", () => {
    const password = "z".repeat(72);
    expect(validateBootstrapPassword(password, "primary-admin")).toEqual({
      ok: true,
      value: password,
    });
  });

  it("rejects a password over the bcrypt byte limit", () => {
    expect(
      validateBootstrapPassword("z".repeat(73), "primary-admin"),
    ).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_TOO_LONG",
    });
  });

  it("applies the bcrypt limit to UTF-8 bytes", () => {
    expect(
      validateBootstrapPassword("é".repeat(37), "primary-admin"),
    ).toMatchObject({
      ok: false,
      code: "BOOTSTRAP_ADMIN_PASSWORD_TOO_LONG",
    });
  });

  it("never echoes a rejected password in its error", () => {
    const password = "z".repeat(73);
    const result = validateBootstrapPassword(password, "primary-admin");

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(password);
  });
});
