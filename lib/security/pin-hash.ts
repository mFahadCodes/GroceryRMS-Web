import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  getPinPepper,
  PIN_SECURITY_DOMAINS,
  PIN_SECURITY_POLICY,
} from "./pin-security-config";

const V2_PREFIX = "pin-v2$";
const LEGACY_HASH_PATTERN = /^[a-f0-9]{64}$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const DUMMY_BCRYPT_HASH =
  "$2b$12$R1syedL34nsM4g.A8IgWSuQLst9iz4mOuiwUw5CrD1hi4FDt6OKh6";

export type PinCreationPolicyResult =
  | { ok: true; value: string }
  | {
      ok: false;
      code: "PIN_INVALID_FORMAT" | "PIN_REPEATED_DIGITS" | "PIN_SEQUENTIAL";
      message: string;
    };

export function validatePinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}

export function validatePinCreationPolicy(pin: unknown): PinCreationPolicyResult {
  if (!validatePinFormat(pin)) {
    return {
      ok: false,
      code: "PIN_INVALID_FORMAT",
      message: "PIN must contain exactly four ASCII digits.",
    };
  }
  if (/^(\d)\1{3}$/.test(pin)) {
    return {
      ok: false,
      code: "PIN_REPEATED_DIGITS",
      message: "PIN must not repeat the same digit.",
    };
  }
  if ("01234567890".includes(pin) || "98765432109".includes(pin)) {
    return {
      ok: false,
      code: "PIN_SEQUENTIAL",
      message: "PIN must not be an ascending or descending sequence.",
    };
  }
  return { ok: true, value: pin };
}

export function isLegacyPinHash(value: unknown): value is string {
  return typeof value === "string" && LEGACY_HASH_PATTERN.test(value);
}

export function isV2PinHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(V2_PREFIX) &&
    BCRYPT_HASH_PATTERN.test(value.slice(V2_PREFIX.length))
  );
}

export function derivePinMaterial(
  userId: number,
  pin: string,
  pepper = getPinPepper(),
): string {
  return createHmac("sha256", pepper)
    .update(PIN_SECURITY_DOMAINS.pin, "utf8")
    .update("\0", "utf8")
    .update(String(userId), "utf8")
    .update("\0", "utf8")
    .update(pin, "utf8")
    .digest("base64url");
}

export function deriveThrottleKey(
  scope: "IP" | "TERMINAL",
  value: string,
  pepper = getPinPepper(),
): string {
  const domain =
    scope === "IP"
      ? PIN_SECURITY_DOMAINS.ipBucket
      : PIN_SECURITY_DOMAINS.terminalBucket;
  return createHmac("sha256", pepper)
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export async function hashPinV2(userId: number, pin: string): Promise<string> {
  const policy = validatePinCreationPolicy(pin);
  if (!policy.ok) {
    throw new Error(policy.code);
  }
  return hashAcceptedPinV2(userId, policy.value);
}

export async function hashLegacyPinV2(
  userId: number,
  pin: string,
): Promise<string> {
  if (!validatePinFormat(pin)) throw new Error("PIN_INVALID_FORMAT");
  return hashAcceptedPinV2(userId, pin);
}

async function hashAcceptedPinV2(userId: number, pin: string) {
  const material = derivePinMaterial(userId, pin);
  return `${V2_PREFIX}${await bcrypt.hash(material, PIN_SECURITY_POLICY.bcryptCost)}`;
}

export async function verifyV2PinHash(
  userId: number,
  pin: string,
  storedHash: string,
): Promise<boolean> {
  if (!isV2PinHash(storedHash) || !validatePinFormat(pin)) return false;
  const material = derivePinMaterial(userId, pin);
  return bcrypt.compare(material, storedHash.slice(V2_PREFIX.length));
}

export function verifyLegacyPinHash(pin: string, storedHash: string): boolean {
  if (!validatePinFormat(pin) || !isLegacyPinHash(storedHash)) return false;
  const actual = Buffer.from(createHash("sha256").update(pin).digest("hex"));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function performDummyPinVerification(
  userId: number,
  pin: string,
): Promise<void> {
  const material = derivePinMaterial(userId, pin);
  await bcrypt.compare(material, DUMMY_BCRYPT_HASH);
}
