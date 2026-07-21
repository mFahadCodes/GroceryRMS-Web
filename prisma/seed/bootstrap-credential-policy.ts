import { validatePasswordPolicy } from "../../lib/security/password-policy";
import { validatePinCreationPolicy } from "../../lib/security/pin-hash";

const MAXIMUM_USERNAME_CHARACTERS = 64;
const PIN_LENGTH = 4;

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
  const result = validatePasswordPolicy(password, username);
  if (result.ok) return result;

  const codeByPolicyFailure = {
    PASSWORD_REQUIRED: "BOOTSTRAP_ADMIN_PASSWORD_REQUIRED",
    PASSWORD_TOO_SHORT: "BOOTSTRAP_ADMIN_PASSWORD_TOO_SHORT",
    PASSWORD_TOO_LONG: "BOOTSTRAP_ADMIN_PASSWORD_TOO_LONG",
    PASSWORD_PLACEHOLDER: "BOOTSTRAP_ADMIN_PASSWORD_PLACEHOLDER",
    PASSWORD_MATCHES_USERNAME: "BOOTSTRAP_ADMIN_PASSWORD_MATCHES_USERNAME",
    PASSWORD_TRIVIAL_USERNAME_VARIATION:
      "BOOTSTRAP_ADMIN_PASSWORD_TRIVIAL_USERNAME_VARIATION",
  } as const;
  return failure(codeByPolicyFailure[result.code], result.message);
}

export function validateBootstrapPin(
  pin: string | undefined,
): CredentialValidationResult<string | null> {
  if (pin === undefined || pin === "") {
    return { ok: true, value: null };
  }

  const result = validatePinCreationPolicy(pin);
  if (!result.ok && result.code === "PIN_INVALID_FORMAT") {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_INVALID_FORMAT",
      `BOOTSTRAP_ADMIN_PIN must contain exactly ${PIN_LENGTH} digits.`,
    );
  }

  if (!result.ok && result.code === "PIN_REPEATED_DIGITS") {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_REPEATED_DIGITS",
      "BOOTSTRAP_ADMIN_PIN must not repeat the same digit.",
    );
  }

  if (!result.ok && result.code === "PIN_SEQUENTIAL") {
    return failure(
      "BOOTSTRAP_ADMIN_PIN_SEQUENTIAL",
      "BOOTSTRAP_ADMIN_PIN must not be an ascending or descending sequence.",
    );
  }

  return result.ok ? result : { ok: true, value: pin };
}

function failure<T>(
  code: BootstrapCredentialFailureCode,
  message: string,
): CredentialValidationResult<T> {
  return { ok: false, code, message };
}
