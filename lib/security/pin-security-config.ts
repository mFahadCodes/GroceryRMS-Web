const MINIMUM_PEPPER_BYTES = 32;

export const PIN_SECURITY_POLICY = {
  bcryptCost: 12,
  userFailureDecayMs: 30 * 60 * 1000,
  aggregateWindowMs: 10 * 60 * 1000,
  aggregateLockMs: 15 * 60 * 1000,
  aggregateRecordTtlMs: 30 * 60 * 1000,
  ipFailureThreshold: 25,
  terminalFailureThreshold: 15,
  cleanupBatchSize: 25,
  safeRetryAfterSeconds: 60,
} as const;

export const PIN_SECURITY_DOMAINS = {
  pin: "groceryrms-pin-hash-v2",
  ipBucket: "groceryrms-pin-rate-limit-ip-v1",
  terminalBucket: "groceryrms-pin-rate-limit-terminal-v1",
} as const;

export class PinSecurityConfigurationError extends Error {
  readonly code = "PIN_SECURITY_UNAVAILABLE";

  constructor() {
    super("PIN security configuration is unavailable");
    this.name = "PinSecurityConfigurationError";
  }
}

export function getPinPepper(
  environment: NodeJS.ProcessEnv = process.env,
): Buffer {
  const value = environment.PIN_PEPPER;
  if (!value || Buffer.byteLength(value, "utf8") < MINIMUM_PEPPER_BYTES) {
    throw new PinSecurityConfigurationError();
  }

  const normalized = value.trim().toLowerCase();
  const isExplicitTestValue =
    environment.NODE_ENV === "test" && normalized.startsWith("test-only-");
  const unsafe =
    normalized.length === 0 ||
    new Set(value).size < 12 ||
    /^(.)\1+$/.test(normalized) ||
    /placeholder|change[-_ ]?me|example|your[-_ ]?secret/.test(normalized);

  if (unsafe && !isExplicitTestValue) {
    throw new PinSecurityConfigurationError();
  }

  return Buffer.from(value, "utf8");
}
