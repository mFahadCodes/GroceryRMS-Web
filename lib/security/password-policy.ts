const MINIMUM_PASSWORD_CHARACTERS = 15;
const MAXIMUM_BCRYPT_BYTES = 72;

const PLACEHOLDER_TERMS = [
  "password",
  "administrator",
  "admin",
  "changeme",
  "default",
  "welcome",
  "qwerty",
] as const;

export type PasswordPolicyFailureCode =
  | "PASSWORD_REQUIRED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_PLACEHOLDER"
  | "PASSWORD_MATCHES_USERNAME"
  | "PASSWORD_TRIVIAL_USERNAME_VARIATION";

export type PasswordPolicyResult =
  | { ok: true; value: string }
  | { ok: false; code: PasswordPolicyFailureCode; message: string };

export function validatePasswordPolicy(
  password: string | undefined,
  username: string,
): PasswordPolicyResult {
  if (password === undefined || password.length === 0 || !password.trim()) {
    return failure("PASSWORD_REQUIRED", "Password must not be empty or whitespace-only.");
  }
  if (Array.from(password).length < MINIMUM_PASSWORD_CHARACTERS) {
    return failure(
      "PASSWORD_TOO_SHORT",
      `Password must be at least ${MINIMUM_PASSWORD_CHARACTERS} characters.`,
    );
  }
  if (Buffer.byteLength(password, "utf8") > MAXIMUM_BCRYPT_BYTES) {
    return failure(
      "PASSWORD_TOO_LONG",
      `Password must be at most ${MAXIMUM_BCRYPT_BYTES} UTF-8 bytes for bcrypt.`,
    );
  }

  const comparablePassword = comparableCredential(password);
  const comparableUsername = comparableCredential(username);
  if (comparablePassword === comparableUsername) {
    return failure(
      "PASSWORD_MATCHES_USERNAME",
      "Password must not equal the username.",
    );
  }
  if (isTrivialUsernameVariation(comparablePassword, comparableUsername)) {
    return failure(
      "PASSWORD_TRIVIAL_USERNAME_VARIATION",
      "Password must not be a trivial variation of the username.",
    );
  }
  if (isPlaceholderStyle(comparablePassword)) {
    return failure(
      "PASSWORD_PLACEHOLDER",
      "Password must not be a placeholder-style or expected password.",
    );
  }
  return { ok: true, value: password };
}

function comparableCredential(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function isPlaceholderStyle(password: string): boolean {
  if (!password) return true;
  let remainder = password;
  for (const term of [...PLACEHOLDER_TERMS].sort(
    (left, right) => right.length - left.length,
  )) {
    remainder = remainder.replaceAll(term, "");
  }
  return remainder.length === 0 || /^\d+$/.test(remainder);
}

function isTrivialUsernameVariation(password: string, username: string): boolean {
  if (!username || !password.includes(username)) return false;
  const remainder = password.replaceAll(username, "");
  return remainder.length === 0 || /^\d+$/.test(remainder);
}

function failure(
  code: PasswordPolicyFailureCode,
  message: string,
): PasswordPolicyResult {
  return { ok: false, code, message };
}
