import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyUserPin } = vi.hoisted(() => ({ verifyUserPin: vi.fn() }));
vi.mock("@/lib/services/pin-security-service", () => ({ verifyUserPin }));

import { resolveManagerApproval } from "../../../lib/manager-pin";

const permission = "Void / cancel orders";
const base = {
  userId: 2,
  permissions: [],
  permissionName: permission,
  minimumLevel: 5,
  clientIp: "203.0.113.2",
};

describe("explicit manager PIN targeting", () => {
  beforeEach(() => verifyUserPin.mockReset());

  it("preserves direct authorization when the actor already has permission", async () => {
    await expect(resolveManagerApproval({ ...base, permissions: [`${permission}:5`] })).resolves.toEqual({ ok: true, approvedByUserId: 2 });
    expect(verifyUserPin).not.toHaveBeenCalled();
  });
  it("requires both manager user ID and PIN", async () => {
    await expect(resolveManagerApproval({ ...base, managerPin: "4826" })).resolves.toMatchObject({ ok: false, code: "MANAGER_PIN_REQUIRED" });
    expect(verifyUserPin).not.toHaveBeenCalled();
  });
  it("verifies only the explicitly selected manager", async () => {
    verifyUserPin.mockResolvedValue({ status: "failed" });
    await resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" });
    expect(verifyUserPin).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, pin: "4826", clientIp: base.clientIp, actorUserId: 2 }));
  });
  it("does not grant approval to a verified user without permission", async () => {
    verifyUserPin.mockResolvedValue({ status: "verified", user: { id: 7, permissions: [`${permission}:2`], mustChangePassword: false } });
    await expect(resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" })).resolves.toMatchObject({ ok: false, code: "INVALID_MANAGER_PIN" });
  });
  it("approves a verified target with the current required permission", async () => {
    verifyUserPin.mockResolvedValue({ status: "verified", user: { id: 7, permissions: [`${permission}:5`], mustChangePassword: false } });
    await expect(resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" })).resolves.toEqual({ ok: true, approvedByUserId: 7 });
  });
  it("does not let a password-rotation-required manager approve", async () => {
    verifyUserPin.mockResolvedValue({ status: "verified", user: { id: 7, permissions: [`${permission}:5`], mustChangePassword: true } });
    await expect(resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" })).resolves.toMatchObject({ ok: false, code: "INVALID_MANAGER_PIN" });
  });
  it("maps throttling without exposing the triggering scope", async () => {
    verifyUserPin.mockResolvedValue({ status: "throttled", retryAfterSeconds: 60 });
    await expect(resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" })).resolves.toEqual({ ok: false, code: "MANAGER_PIN_THROTTLED", retryAfterSeconds: 60 });
  });
  it("fails closed when PIN security is unavailable", async () => {
    verifyUserPin.mockResolvedValue({ status: "security-unavailable" });
    await expect(resolveManagerApproval({ ...base, managerUserId: 7, managerPin: "4826" })).resolves.toMatchObject({ ok: false, code: "PIN_SECURITY_UNAVAILABLE" });
  });
});
