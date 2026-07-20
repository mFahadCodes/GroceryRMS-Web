const MINIMUM_PASSWORD_CHARACTERS = 15;
const MAXIMUM_BCRYPT_BYTES = 72;
const MAXIMUM_USERNAME_CHARACTERS = 64;
const PIN_LENGTH = 4;

const PLACEHOLDER_TERMS = [
  "password",
  "administrator",
  "admin",
  "changeme",
  "default",
  "welcome",
  "qwerty",
] as const;

export type BootstrapCredentialFailureCode =
  | "BOOTSTRAP_ADMIN_USERNAME_REQUIRED"
  | "BOOTSTRAP_ADMIN_USERNAME_TOO_LONG"
  | "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED"
  | "BOOTSTRAP_ADMIN_PASSWORD_TOO_SHORT"
  | "BOOTSTRAP_ADMIN_PASSWORD_TOO_LONG"
  | "BOOTSTRAP_ADMIN_PASSWORD_PLACEHOLDER"
  | "BOOTSTRAP_ADMIN_PASSWORD_MATCHES_USERNAME"
  | "BOOTSTRAP_ADMIN_PASSWORD_TRIVIAL_USERNAME_VARIATION"
  | "BOOTSTRAP_ADMIN_PIN_INVALID_FORMAT"
  | "BOOTSTRAP_ADMIN_PIN_REPEATED_DIGITS"
  | "BOOTSTRAP_ADMIN_PIN_SEQUENTIAL";

export type CredentialValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: BootstrapCredentialFailureCode;
      message: string;
    };

export interface BootstrapEnvironmentInput {
  username: string | undefined;
  password: string | undefined;
  pin: string | undefined;
}

export interface BootstrapEnvironmentSource {
  BOOTSTRAP_ADMIN_USERNAME?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_ADMIN_PIN?: string;
}

export function readBootstrapEnvironment(
  environment: BootstrapEnvironmentSource,
): BootstrapEnvironmentInput {
  return {
    username: environment.BOOTSTRAP_ADMIN_USERNAME,
    password: environment.BOOTSTRAP_ADMIN_PASSWORD,
    pin: environment.BOOTSTRAP_ADMIN_PIN,
  };
}

export function validateBootstrapUsername(
  username: string | undefined,
): CredentialValidationResult<string> {
  const normalizedUsername = username?.trim() ?? "";

  if (!normalizedUsername) {
    return failure(
      "BOOTSTRAP_ADMIN_USERNAME_REQUIRED",
      "BOOTSTRAP_ADMIN_USERNAME is required to create the first administrator.",
    );
  }

  if (Array.from(normalizedUsername).length > MAXIMUM_USERNAME_CHARACTERS) {
    return failure(
      "BOOTSTRAP_ADMIN_USERNAME_TOO_LONG",
      `BOOTSTRAP_ADMIN_USERNAME must be at most ${MAXIMUM_USERNAME_CHARACTERS} characters.`,
    );
  }

  return { ok: true, value: normalizedUsername };
}

export function validateBootstrapPassword(
  password: string | undefined,
  username: string,
): CredentialValidationResult<string> {
  if (password === undefined || password.length === 0) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED",
      "BOOTSTRAP_ADMIN_PASSWORD is required to create the first administrator.",
    );
  }

  if (!password.trim()) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED",
      "BOOTSTRAP_ADMIN_PASSWORD must not be empty or whitespace-only.",
    );
  }

  if (Array.from(password).length < MINIMUM_PASSWORD_CHARACTERS) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_TOO_SHORT",
      `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MINIMUM_PASSWORD_CHARACTERS} characters.`,
    );
  }

  if (Buffer.byteLength(password, "utf8") > MAXIMUM_BCRYPT_BYTES) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_TOO_LONG",
      `BOOTSTRAP_ADMIN_PASSWORD must be at most ${MAXIMUM_BCRYPT_BYTES} UTF-8 bytes for bcrypt.`,
    );
  }

  const comparablePassword = comparableCredential(password);
  const comparableUsername = comparableCredential(username);

  if (comparablePassword === comparableUsername) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_MATCHES_USERNAME",
      "BOOTSTRAP_ADMIN_PASSWORD must not equal the administrator username.",
    );
  }

  if (isTrivialUsernameVariation(comparablePassword, comparableUsername)) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_TRIVIAL_USERNAME_VARIATION",
      "BOOTSTRAP_ADMIN_PASSWORD must not be a trivial variation of the administrator username.",
    );
  }

  if (isPlaceholderStyle(comparablePassword)) {
    return failure(
      "BOOTSTRAP_ADMIN_PASSWORD_PLACEHOLDER",
      "BOOTSTRAP_ADMIN_PASSWORD must not be a placeholder-style password.",
    );
  }

  return { ok: true, value: password };
}

export function validateBootstrapPin(
  pin: string | undefined,
): CredentialValidationResult<string | null> {
  if (pin === undefined || pin === "") {
    return { ok: true, value: null };
  }

  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_INVALID_FORMAT",
      `BOOTSTRAP_ADMIN_PIN must contain exactly ${PIN_LENGTH} digits.`,
    );
  }

  if (/^(\d)\1+$/.test(pin)) {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_REPEATED_DIGITS",
      "BOOTSTRAP_ADMIN_PIN must not repeat the same digit.",
    );
  }

  if (isSequentialPin(pin)) {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_SEQUENTIAL",
      "BOOTSTRAP_ADMIN_PIN must not be an ascending or descending sequence.",
    );
  }

  return { ok: true, value: pin };
}

function comparableCredential(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function isPlaceholderStyle(password: string): boolean {
  if (!password) {
    return true;
  }

  let remainder = password;
  for (const term of [...PLACEHOLDER_TERMS].sort(
    (left, right) => right.length - left.length,
  )) {
    remainder = remainder.replaceAll(term, "");
  }

  return remainder.length === 0 || /^\d+$/.test(remainder);
}

function isTrivialUsernameVariation(
  password: string,
  username: string,
): boolean {
  if (!username || !password.includes(username)) {
    return false;
  }

  const remainder = password.replaceAll(username, "");
  return remainder.length === 0 || /^\d+$/.test(remainder);
}

function isSequentialPin(pin: string): boolean {
  return "01234567890".includes(pin) || "98765432109".includes(pin);
}

function failure<T>(
  code: BootstrapCredentialFailureCode,
  message: string,
): CredentialValidationResult<T> {
  return { ok: false, code, message };
}
