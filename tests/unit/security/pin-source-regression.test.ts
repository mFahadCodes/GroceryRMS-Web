import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("PIN security source regression", () => {
  it("contains no global manager candidate scan", () => {
    const source = read("lib/manager-pin.ts");
    expect(source).not.toMatch(/findMany|where:\s*\{\s*pin/);
    expect(source).toContain("managerUserId");
  });
  it("contains no anonymous PIN lookup in authentication", () => {
    for (const file of ["lib/auth.ts", "app/api/auth/login/route.ts"]) {
      expect(read(file)).not.toMatch(/where:\s*\{[^}]*pin/);
    }
  });
  it("keeps legacy SHA-256 creation isolated to verification", () => {
    const matches = ["lib/security/pin-hash.ts", "lib/services/settings-service.ts", "prisma/seed.ts"].filter((file) => /createHash\(["']sha256/.test(read(file)));
    expect(matches).toEqual(["lib/security/pin-hash.ts"]);
  });
  it("has no PIN pepper fallback", () => {
    const source = read("lib/security/pin-security-config.ts");
    expect(source).toContain("environment.PIN_PEPPER");
    expect(source).not.toMatch(/PIN_PEPPER\s*(?:\?\?|\|\|)/);
    expect(source).not.toContain("AUTH_SECRET");
  });
  it("does not log a PIN request body", () => {
    const files = ["app/api/auth/login/route.ts", "app/api/auth/validate-pin/route.ts", "lib/services/pin-security-service.ts"];
    for (const file of files) expect(read(file)).not.toMatch(/console\.|JSON\.stringify\(.*pin/i);
  });
  it("does not put manager PINs in order audit metadata", () => {
    for (const file of ["app/api/orders/[id]/discount/route.ts", "app/api/orders/[id]/void/route.ts"]) {
      const source = read(file);
      expect(source.match(/newValues:[\s\S]*?\n\s*},/g)?.join("\n") ?? "").not.toContain("managerPin");
    }
  });
  it("protects lockout reset with the user-management permission", () => {
    const source = read("app/api/settings/users/[id]/pin-lockout/reset/route.ts");
    expect(source).toContain("requirePermission(PERMS.MANAGE_USERS_ROLES");
  });
  it("keeps password-rotation enforcement on PIN validation", () => {
    const source = read("app/api/auth/validate-pin/route.ts");
    expect(source).toContain("requireSession()");
    expect(source).not.toContain("allowPasswordChangeRequired");
  });
  it("allows direct PIN writes only from secure hash outputs", () => {
    const settings = read("lib/services/settings-service.ts");
    const seed = read("prisma/seed.ts");
    expect(settings).toContain("securePinHashOrThrow");
    expect(seed).toContain("createSecurePinHash");
    expect(settings).not.toContain("createHash(");
  });
});
