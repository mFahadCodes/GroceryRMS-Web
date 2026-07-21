import { describe, expect, it } from "vitest";
import {
  AUDIT_REDACTED,
  AUDIT_UNSUPPORTED,
  sanitizeAuditError,
  sanitizeAuditMetadata,
  serializeSafeAuditMetadata,
} from "../../../lib/security/audit-sanitizer";

describe("audit error sanitization", () => {
  it("retains safe name, code, and sanitized message", () => {
    const error = Object.assign(new Error("failed for order 50"), {
      code: "ORDER_FAILED",
    });
    const sanitized = sanitizeAuditError(error);
    expect(sanitized.name).toBe("Error");
    expect(sanitized.code).toBe("ORDER_FAILED");
    expect(sanitized.message).toBe("failed for order 50");
    expect(sanitized.stack).toBeUndefined();
  });

  it("redacts passwords and tokens in error messages", () => {
    const withBearer = sanitizeAuditError(
      new Error("Bearer SYNTHETIC.JWT.TOKENVALUE"),
    );
    expect(withBearer.message).toBe(AUDIT_REDACTED);

    const nested = sanitizeAuditMetadata({
      error: new Error("password=SuperSecret1! token=abc"),
    }) as {
      error: { message: string; stack?: string };
    };
    expect(nested.error.stack).toBeUndefined();
    expect(JSON.stringify(nested)).not.toContain("SuperSecret1!");
    expect(nested.error.message).toBe(AUDIT_REDACTED);
  });

  it("does not persist stack, request, config, or response objects", () => {
    const error = new Error("boom");
    (error as Error & { stack: string }).stack = "secret-stack";
    const sanitized = sanitizeAuditError(error);
    expect(sanitized.stack).toBeUndefined();
    const wrapped = sanitizeAuditMetadata({
      err: error,
      request: { headers: { authorization: "Bearer x" } },
      config: { password: "x" },
      response: { body: "y" },
    }) as Record<string, unknown>;
    expect(JSON.stringify(wrapped)).not.toContain("secret-stack");
    expect((wrapped.request as { headers: string }).headers).toBe(
      AUDIT_REDACTED,
    );
  });

  it("handles circular error causes without throwing", () => {
    const error = new Error("root");
    const cause = new Error("cause");
    (error as Error & { cause: Error }).cause = cause;
    (cause as Error & { cause: Error }).cause = error;
    expect(() => sanitizeAuditError(error)).not.toThrow();
    const sanitized = sanitizeAuditError(error);
    expect(sanitized.cause).toEqual({ name: "Error" });
  });

  it("bounds Prisma-like error fields and unknown error shapes", () => {
    const prismaLike = {
      name: "PrismaClientKnownRequestError",
      message: "Unique constraint",
      code: "P2002",
      meta: { target: ["username"], password: "nope" },
    };
    const sanitized = sanitizeAuditMetadata({ err: prismaLike }) as {
      err: { meta: { password: string; target: string[] } };
    };
    expect(sanitized.err.meta.password).toBe(AUDIT_REDACTED);
    expect(sanitized.err.meta.target).toEqual(["username"]);
    expect(sanitizeAuditError(42)).toEqual({
      name: "Error",
      message: AUDIT_UNSUPPORTED,
    });
  });

  it("sanitizer failure fallback does not expose original metadata", () => {
    const json = serializeSafeAuditMetadata({
      password: "SHOULD_NOT_APPEAR",
    });
    expect(json).not.toContain("SHOULD_NOT_APPEAR");
  });
});
