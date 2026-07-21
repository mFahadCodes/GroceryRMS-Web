import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  verifyUserPin: vi.fn(),
}));
vi.mock("@/lib/api/rbac", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/services/pin-security-service", () => ({ verifyUserPin: mocks.verifyUserPin }));

import { POST } from "../../../app/api/auth/validate-pin/route";

describe("PIN verification API responses", () => {
  beforeEach(() => {
    mocks.requireSession.mockResolvedValue({ session: { user: { id: 2 } } });
    mocks.verifyUserPin.mockReset();
  });

  it("rejects PIN-only requests", async () => {
    const response = await POST(request({ pin: "4826" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("uses the generic failed response", async () => {
    mocks.verifyUserPin.mockResolvedValue({ status: "failed" });
    const response = await POST(request({ userId: 7, pin: "4826" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "PIN verification failed", code: "PIN_VERIFICATION_FAILED" });
  });
  it("returns a safe Retry-After for throttling", async () => {
    mocks.verifyUserPin.mockResolvedValue({ status: "throttled", retryAfterSeconds: 60 });
    const response = await POST(request({ userId: 7, pin: "4826" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ code: "PIN_VERIFICATION_THROTTLED" });
  });
  it("fails closed when PIN security is unavailable", async () => {
    mocks.verifyUserPin.mockResolvedValue({ status: "security-unavailable" });
    const response = await POST(request({ userId: 7, pin: "4826" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PIN_SECURITY_UNAVAILABLE" });
  });
  it("returns only safe identity after success", async () => {
    mocks.verifyUserPin.mockResolvedValue({ status: "verified", user: { id: 7, fullName: "Manager", roleName: "manager" } });
    const response = await POST(request({ userId: 7, pin: "4826" }));
    expect(await response.json()).toEqual({ success: true, data: { valid: true, userId: 7, fullName: "Manager", role: "manager" } });
  });
  it("derives IP server-side and passes the authenticated actor", async () => {
    mocks.verifyUserPin.mockResolvedValue({ status: "failed" });
    await POST(request({ userId: 7, pin: "4826" }, { "x-real-ip": "198.51.100.9" }));
    expect(mocks.verifyUserPin).toHaveBeenCalledWith({ userId: 7, pin: "4826", clientIp: "198.51.100.9", actorUserId: 2 });
  });
  it("rejects oversized bodies before parsing", async () => {
    const response = await POST(request({ userId: 7, pin: "4826" }, { "content-length": "5000" }));
    expect(response.status).toBe(413);
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
  });
});

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/validate-pin", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
