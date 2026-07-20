import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LEGACY_CREDENTIAL_DIGESTS = new Set([
  "e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7",
  "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".example",
]);

function trackedTextFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(path.join(process.cwd(), file)))
    .filter((file) => {
      if (file === ".env.example" || file === ".env.test.example") return true;
      if (file === "package-lock.json") return false;
      return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
    });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function credentialTokens(source: string): string[] {
  return source.match(/[A-Za-z0-9@!#$%^&*._+-]{4,}/g) ?? [];
}

describe("tracked credential source regression scan", () => {
  const files = trackedTextFiles();

  it("contains no legacy credential literal", () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      const credentialSource = source
        .split(/\r?\n/)
        .filter((line) =>
          /admin|credential|login|password|pin|secret/i.test(line),
        )
        .join("\n");
      return credentialTokens(credentialSource).some((value) =>
        LEGACY_CREDENTIAL_DIGESTS.has(digest(value)),
      )
        ? [`${file}: legacy credential literal`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("contains no fixed seed password or PIN assignment", () => {
    const source = readFileSync(
      path.join(process.cwd(), "prisma/seed.ts"),
      "utf8",
    );
    const violations = [
      /const\s+ADMIN_PASSWORD\s*=/,
      /const\s+ADMIN_PIN\s*=/,
      /bcrypt\.hash\(\s*["'`]/,
      /hashPin\(\s*["'`]/,
      /BOOTSTRAP_ADMIN_(?:USERNAME|PASSWORD|PIN)[^\r\n]*(?:\?\?|\|\|)\s*["'`]/,
      /user\.upsert\s*\(/,
    ].flatMap((rule) =>
      rule.test(source) ? ["prisma/seed.ts: fixed credential assignment"] : [],
    );

    expect(violations).toEqual([]);
  });

  it("contains no smoke or verification credential fallback", () => {
    const violations = ["scripts/smoke-api.mjs", "scripts/verify-auth.mjs"].flatMap(
      (file) => {
        const source = readFileSync(path.join(process.cwd(), file), "utf8");
        return [
          /SMOKE_ADMIN_(?:USERNAME|PASSWORD|PIN)[^\r\n]*(?:\?\?|\|\|)\s*["'`]/,
          /loginNextAuth\(\s*["'`][^"'`]+["'`]\s*,\s*["'`]/,
          /bcrypt\.compare\(\s*["'`]/,
        ].some((rule) => rule.test(source))
          ? [`${file}: smoke credential fallback`]
          : [];
      },
    );

    expect(violations).toEqual([]);
  });

  it("keeps tracked environment examples free of credential values", () => {
    const violations = [".env.example", ".env.test.example"].flatMap((file) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      return source
        .split(/\r?\n/)
        .filter((line) =>
          /^(?:(?:BOOTSTRAP|SMOKE)_ADMIN_(?:USERNAME|PASSWORD|PIN)|PIN_PEPPER)=.+/.test(
            line,
          ),
        )
        .map(() => `${file}: plaintext credential example`);
    });

    expect(violations).toEqual([]);
  });
});
