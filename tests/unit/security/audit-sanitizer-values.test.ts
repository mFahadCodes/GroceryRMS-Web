import { describe, expect, it } from "vitest";
import {
  AUDIT_REDACTED,
  sanitizeAuditMetadata,
  sanitizeSensitiveStringValue,
  serializeSafeAuditMetadata,
} from "../../../lib/security/audit-sanitizer";

describe("audit sanitizer value pattern redaction", () => {
  it("redacts Bearer tokens under generic keys", () => {
    const sanitized = sanitizeAuditMetadata({
      detail: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
    }) as { detail: string };
    expect(sanitized.detail).toBe(AUDIT_REDACTED);
  });

  it("redacts JWT-like three-part tokens", () => {
    expect(
      sanitizeSensitiveStringValue(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ),
    ).toBe(AUDIT_REDACTED);
  });

  it("redacts Basic authentication values", () => {
    expect(sanitizeSensitiveStringValue("Basic dXNlcjpwYXNz")).toBe(
      AUDIT_REDACTED,
    );
  });

  it("redacts PEM private-key headers", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----";
    expect(sanitizeSensitiveStringValue(pem)).toBe(AUDIT_REDACTED);
  });

  it("redacts credentials from URLs while preserving useful structure", () => {
    const sanitized = sanitizeSensitiveStringValue(
      "https://user:secret@example.com/path?token=abc&q=1",
    );
    expect(sanitized).toContain("example.com");
    expect(sanitized).toContain("/path");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).not.toMatch(/token=abc/);
    expect(sanitized).toMatch(/redacted/i);
  });

  it("redacts credential-bearing database URLs", () => {
    const sanitized = sanitizeSensitiveStringValue(
      "postgres://admin:hunter2@db.internal:5432/pos",
    );
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).toMatch(/redacted/i);
  });

  it("redacts cookie-header style strings", () => {
    expect(
      sanitizeSensitiveStringValue("session=abc123; path=/; HttpOnly"),
    ).toBe(AUDIT_REDACTED);
  });

  it("redacts opaque high-entropy tokens and bcrypt digests", () => {
    expect(sanitizeSensitiveStringValue("A".repeat(43))).toBe(AUDIT_REDACTED);
    expect(
      sanitizeSensitiveStringValue(
        "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
      ),
    ).toBe(AUDIT_REDACTED);
  });

  it("preserves ordinary safe text, order numbers, and ids", () => {
    const sanitized = sanitizeAuditMetadata({
      note: "Deliver to gate B",
      orderNumber: "ORD-50",
      orderId: 50,
      status: "issued",
    }) as Record<string, unknown>;
    expect(sanitized.note).toBe("Deliver to gate B");
    expect(sanitized.orderNumber).toBe("ORD-50");
    expect(sanitized.orderId).toBe(50);
    expect(sanitized.status).toBe("issued");
  });

  it("does not embed matched secrets in serialized output", () => {
    const json = serializeSafeAuditMetadata({
      info: "Bearer SYNTHETIC_TEST_TOKEN_VALUE_NOT_REAL",
    });
    expect(json).not.toContain("SYNTHETIC_TEST_TOKEN_VALUE_NOT_REAL");
    expect(json).toContain(AUDIT_REDACTED);
  });
});
