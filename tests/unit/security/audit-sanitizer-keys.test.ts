import { describe, expect, it } from "vitest";
import {
  AUDIT_REDACTED,
  isSensitiveAuditKey,
  normalizeAuditKey,
  sanitizeAuditMetadata,
  serializeSafeAuditMetadata,
} from "../../../lib/security/audit-sanitizer";

describe("audit sanitizer key redaction", () => {
  it.each([
    ["password", "Password"],
    ["current_password", "currentPassword"],
    ["current-password", "currentPassword"],
    ["CURRENT PASSWORD", "currentPassword"],
    ["newPassword", "newPassword"],
    ["oldPassword", "oldPassword"],
    ["passwordHash", "passwordHash"],
    ["bootstrapPassword", "bootstrapPassword"],
    ["temporaryPassword", "temporaryPassword"],
    ["credential", "credential"],
    ["pin", "pin"],
    ["managerPin", "managerPin"],
    ["adminPin", "adminPin"],
    ["bootstrapPin", "bootstrapPin"],
    ["pinHash", "pinHash"],
    ["pinPepper", "pinPepper"],
    ["pepper", "pepper"],
    ["token", "token"],
    ["accessToken", "accessToken"],
    ["refreshToken", "refreshToken"],
    ["idToken", "idToken"],
    ["approvalToken", "approvalToken"],
    ["managerApprovalToken", "managerApprovalToken"],
    ["tokenHash", "tokenHash"],
    ["jwt", "jwt"],
    ["authorization", "authorization"],
    ["cookie", "cookie"],
    ["setCookie", "setCookie"],
    ["sessionToken", "sessionToken"],
    ["csrfToken", "csrfToken"],
    ["sessionId", "sessionId"],
    ["sessionIdentifier", "sessionIdentifier"],
    ["authoritativeSessionId", "authoritativeSessionId"],
    ["secret", "secret"],
    ["clientSecret", "clientSecret"],
    ["authSecret", "authSecret"],
    ["apiKey", "apiKey"],
    ["privateKey", "privateKey"],
    ["connectionString", "connectionString"],
    ["databaseUrl", "databaseUrl"],
    ["requestBody", "requestBody"],
    ["rawBody", "rawBody"],
    ["headers", "headers"],
    ["cookies", "cookies"],
    ["body", "body"],
    ["authVersion", "authVersion"],
  ])("redacts sensitive key form %s", (inputKey) => {
    expect(isSensitiveAuditKey(inputKey)).toBe(true);
    const sanitized = sanitizeAuditMetadata({ [inputKey]: "secret-value" }) as Record<
      string,
      unknown
    >;
    expect(sanitized[inputKey]).toBe(AUDIT_REDACTED);
  });

  it.each([
    ["confirmPassword", "confirm-me"],
    ["newPin", "4826"],
    ["old_pin", "1111"],
    ["hash", "$2a$10$abcdefghijklmnopqrstuv"],
    ["digest", "abc123digest"],
    ["stack", "at secret-frame"],
    ["userPassword", "x"],
    ["api_secret", "y"],
  ])("redacts compound or artifact key %s", (inputKey, raw) => {
    expect(isSensitiveAuditKey(inputKey)).toBe(true);
    const sanitized = sanitizeAuditMetadata({ [inputKey]: raw }) as Record<
      string,
      unknown
    >;
    expect(sanitized[inputKey]).toBe(AUDIT_REDACTED);
    expect(JSON.stringify(sanitized)).not.toContain(raw);
  });

  it.each([
    "passwordChangedAt",
    "passwordChanged",
    "reauthenticationRequired",
    "authVersionChanged",
    "cookieEnabled",
    "tokenCount",
    "pinCodeRequired",
    "sessionCount",
    "mustChangePassword",
  ])("keeps safe near-match key %s visible", (key) => {
    expect(isSensitiveAuditKey(key)).toBe(false);
    const sanitized = sanitizeAuditMetadata({ [key]: true }) as Record<
      string,
      unknown
    >;
    expect(sanitized[key]).toBe(true);
  });

  it("normalizes key separators consistently", () => {
    expect(normalizeAuditKey("current_password")).toBe("currentpassword");
    expect(normalizeAuditKey("current-password")).toBe("currentpassword");
    expect(normalizeAuditKey("currentPassword")).toBe("currentpassword");
    expect(normalizeAuditKey("CURRENT PASSWORD")).toBe("currentpassword");
  });

  it("redacts nested sensitive keys and array entries", () => {
    const sanitized = sanitizeAuditMetadata({
      outer: { password: "x", nested: [{ managerPin: "9998", ok: true }] },
    }) as {
      outer: { password: string; nested: Array<{ managerPin: string; ok: boolean }> };
    };
    expect(sanitized.outer.password).toBe(AUDIT_REDACTED);
    expect(sanitized.outer.nested[0]!.managerPin).toBe(AUDIT_REDACTED);
    expect(sanitized.outer.nested[0]!.ok).toBe(true);
  });

  it("serializes redacted metadata without original secrets", () => {
    const json = serializeSafeAuditMetadata({
      password: "SuperSecret1!",
      action: "UPDATE_USER",
    });
    expect(json).toContain(AUDIT_REDACTED);
    expect(json).not.toContain("SuperSecret1!");
    expect(json).toContain("UPDATE_USER");
  });
});
