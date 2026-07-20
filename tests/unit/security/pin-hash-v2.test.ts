import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveThrottleKey,
  hashPinV2,
  isLegacyPinHash,
  isV2PinHash,
  validatePinCreationPolicy,
  validatePinFormat,
  verifyLegacyPinHash,
  verifyV2PinHash,
} from "../../../lib/security/pin-hash";

describe("versioned PIN hashing", () => {
  it("accepts exactly four ASCII digits for verification", () => {
    expect(validatePinFormat("4826")).toBe(true);
  });
  it.each(["482", "48260", " 4826", "4826 ", "４８２６", "48a6"])(
    "rejects invalid format %j",
    (pin) => expect(validatePinFormat(pin)).toBe(false),
  );
  it.each(["0000", "7777"])("rejects repeated creation PIN %s", (pin) => {
    expect(validatePinCreationPolicy(pin)).toMatchObject({ ok: false });
  });
  it.each(["0123", "7890", "9876", "2109"])(
    "rejects sequential creation PIN %s",
    (pin) => expect(validatePinCreationPolicy(pin)).toMatchObject({ ok: false }),
  );
  it("creates an unambiguous v2 bcrypt hash", async () => {
    const hash = await hashPinV2(7, "4826");
    expect(hash).toMatch(/^pin-v2\$\$2[aby]\$12\$/);
    expect(hash).not.toContain("4826");
  });
  it("verifies only for the bound user", async () => {
    const hash = await hashPinV2(7, "4826");
    await expect(verifyV2PinHash(7, "4826", hash)).resolves.toBe(true);
    await expect(verifyV2PinHash(8, "4826", hash)).resolves.toBe(false);
  });
  it("rejects an incorrect PIN", async () => {
    const hash = await hashPinV2(7, "4826");
    await expect(verifyV2PinHash(7, "5937", hash)).resolves.toBe(false);
  });
  it.each(["pin-v2$bad", "pin-v3$anything", "", null])(
    "rejects malformed or unsupported hash %j",
    (hash) => expect(isV2PinHash(hash)).toBe(false),
  );
  it("strictly recognizes a legacy SHA-256 digest", () => {
    const legacy = createHash("sha256").update("1111").digest("hex");
    expect(isLegacyPinHash(legacy)).toBe(true);
    expect(isV2PinHash(legacy)).toBe(false);
  });
  it("verifies a weak legacy PIN without applying creation policy", () => {
    const legacy = createHash("sha256").update("1111").digest("hex");
    expect(verifyLegacyPinHash("1111", legacy)).toBe(true);
  });
  it("does not accept an incorrect legacy PIN", () => {
    const legacy = createHash("sha256").update("1111").digest("hex");
    expect(verifyLegacyPinHash("2222", legacy)).toBe(false);
  });
  it("derives separate opaque IP and terminal keys", () => {
    const ip = deriveThrottleKey("IP", "203.0.113.5");
    const terminal = deriveThrottleKey("TERMINAL", "203.0.113.5");
    expect(ip).toMatch(/^[a-f0-9]{64}$/);
    expect(terminal).not.toBe(ip);
    expect(ip).not.toContain("203.0.113.5");
  });
});
