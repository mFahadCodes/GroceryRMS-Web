import { describe, expect, it } from "vitest";
import { changePasswordSchema } from "../../../lib/validators/auth.validators";

describe("password-change request contract", () => {
  it("accepts only current and new password strings", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "current", newPassword: "replacement" }).success).toBe(true);
  });
  it("requires the current password", () => {
    expect(changePasswordSchema.safeParse({ newPassword: "replacement" }).success).toBe(false);
  });
  it("requires the new password", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "current" }).success).toBe(false);
  });
  it("rejects a client-supplied target user ID", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "current", newPassword: "replacement", userId: 99 }).success).toBe(false);
  });
  it("preserves password whitespace exactly", () => {
    const input = { currentPassword: " current ", newPassword: " replacement " };
    expect(changePasswordSchema.parse(input)).toEqual(input);
  });
});
