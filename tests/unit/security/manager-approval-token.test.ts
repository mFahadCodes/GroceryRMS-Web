import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  digestManagerApprovalToken,
  generateManagerApprovalToken,
  isManagerApprovalAction,
  isValidManagerApprovalToken,
  MANAGER_APPROVAL_ACTIONS,
  MANAGER_APPROVAL_TOKEN_BYTES,
} from "../../../lib/security/manager-approval";
import { deterministicApprovalToken } from "./manager-approval-test-database";

describe("manager approval token primitives", () => {
  it("generates a 32-byte base64url token", () => {
    const seenSizes: number[] = [];
    const token = generateManagerApprovalToken((size) => {
      seenSizes.push(size);
      return Buffer.alloc(size, 7);
    });
    expect(seenSizes).toEqual([MANAGER_APPROVAL_TOKEN_BYTES]);
    expect(MANAGER_APPROVAL_TOKEN_BYTES).toBe(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidManagerApprovalToken(token)).toBe(true);
  });

  it("produces unique tokens across sequential generation", () => {
    const tokens = new Set(
      Array.from({ length: 40 }, (_, index) =>
        deterministicApprovalToken(index + 1),
      ),
    );
    expect(tokens.size).toBe(40);
  });

  it("stores only the SHA-256 digest of the raw token", () => {
    const token = deterministicApprovalToken(3);
    const digest = digestManagerApprovalToken(token);
    expect(digest).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
    expect(digest).toHaveLength(64);
    expect(digest).not.toBe(token);
    expect(digest.includes(token)).toBe(false);
  });

  it("rejects malformed tokens before digesting semantics apply", () => {
    expect(isValidManagerApprovalToken(null)).toBe(false);
    expect(isValidManagerApprovalToken(undefined)).toBe(false);
    expect(isValidManagerApprovalToken(12)).toBe(false);
    expect(isValidManagerApprovalToken("")).toBe(false);
    expect(isValidManagerApprovalToken("short")).toBe(false);
    expect(isValidManagerApprovalToken("A".repeat(42))).toBe(false);
    expect(isValidManagerApprovalToken("A".repeat(44))).toBe(false);
    expect(isValidManagerApprovalToken(`${"A".repeat(42)}+`)).toBe(false);
    expect(isValidManagerApprovalToken(`${"A".repeat(42)}/`)).toBe(false);
    expect(isValidManagerApprovalToken(`${"A".repeat(42)}=`)).toBe(false);
  });

  it("accepts a well-formed deterministic base64url token", () => {
    expect(isValidManagerApprovalToken(deterministicApprovalToken(8))).toBe(
      true,
    );
  });

  it("recognizes only the known approval actions", () => {
    expect(MANAGER_APPROVAL_ACTIONS).toEqual(["order.discount", "order.void"]);
    expect(isManagerApprovalAction("order.discount")).toBe(true);
    expect(isManagerApprovalAction("order.void")).toBe(true);
    expect(isManagerApprovalAction("order.refund")).toBe(false);
    expect(isManagerApprovalAction("")).toBe(false);
  });
});
