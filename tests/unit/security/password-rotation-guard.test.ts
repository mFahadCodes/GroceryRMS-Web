import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPasswordRotationBlocked } from "../../../lib/security/password-rotation";

describe("mandatory password-rotation guard", () => {
  it("allows an ordinary user", () => expect(isPasswordRotationBlocked(false)).toBe(false));
  it("blocks a user awaiting rotation by default", () => expect(isPasswordRotationBlocked(true)).toBe(true));
  it("supports the explicit minimum-operation exception", () => expect(isPasswordRotationBlocked(true, true)).toBe(false));
  it("does not let an exception affect a normal user", () => expect(isPasswordRotationBlocked(false, true)).toBe(false));

  it("uses the exception only in the password-change API", () => {
    const files = [
      "app/api/auth/change-password/route.ts",
      "app/api/auth/validate-pin/route.ts",
      "app/api/orders/route.ts",
      "app/api/inventory/summary/route.ts",
      "app/api/reports/daily-summary/route.ts",
      "app/api/settings/users/route.ts",
    ];
    const uses = files.filter((file) =>
      readFileSync(path.resolve(file), "utf8").includes("allowPasswordChangeRequired: true"),
    );
    expect(uses).toEqual(["app/api/auth/change-password/route.ts"]);
  });

  it.each([
    "app/api/auth/validate-pin/route.ts",
    "app/api/orders/route.ts",
    "app/api/inventory/summary/route.ts",
    "app/api/reports/daily-summary/route.ts",
    "app/api/settings/users/route.ts",
  ])("keeps %s behind the default central guard", (file) => {
    const source = readFileSync(path.resolve(file), "utf8");
    expect(source).toMatch(/require(?:Session|Permission)\(/);
    expect(source).not.toContain("allowPasswordChangeRequired: true");
  });
});
