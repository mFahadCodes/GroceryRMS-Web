import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deterministicApprovalToken } from "./manager-approval-test-database";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  issueManagerApprovalGrant: vi.fn(),
  cleanupManagerApprovalGrants: vi.fn(),
  resolveClientIp: vi.fn(() => "198.51.100.20"),
}));

vi.mock("@/lib/api/rbac", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/client-ip", () => ({ resolveClientIp: mocks.resolveClientIp }));
vi.mock("@/lib/services/manager-approval-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/services/manager-approval-service")
  >("../../../lib/services/manager-approval-service");
  return {
    ...actual,
    issueManagerApprovalGrant: mocks.issueManagerApprovalGrant,
    cleanupManagerApprovalGrants: mocks.cleanupManagerApprovalGrants,
  };
});

import { POST } from "../../../app/api/auth/manager-approvals/route";
import { ManagerApprovalServiceError } from "../../../lib/services/manager-approval-service";

const RAW_TOKEN = deterministicApprovalToken(55);

function authoritativeSession() {
  return {
    session: {
      user: {
        id: 2,
        permissions: ["Apply discounts:1"],
      },
      authoritative: {
        sessionId: "mgr_approval_req_session_abcdefgh",
        authVersion: 1,
        terminalId: 1,
      },
    },
  };
}

describe("manager approval issuance route", () => {
  beforeEach(() => {
    mocks.requireSession.mockResolvedValue(authoritativeSession());
    mocks.issueManagerApprovalGrant.mockReset();
    mocks.cleanupManagerApprovalGrants.mockResolvedValue(0);
    mocks.resolveClientIp.mockReturnValue("198.51.100.20");
  });

  it("rejects non-authoritative sessions", async () => {
    mocks.requireSession.mockResolvedValue({
      session: { user: { id: 2, permissions: [] }, authoritative: null },
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "MANAGER_APPROVAL_UNAVAILABLE",
    });
    expect(mocks.issueManagerApprovalGrant).not.toHaveBeenCalled();
  });

  it("rejects invalid request bodies", async () => {
    const response = await POST(
      request({ managerUserId: 7, managerPin: "4826" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects unknown fields under the strict issuance schema", async () => {
    const response = await POST(
      request({ ...validBody(), terminalId: 9 }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects oversized bodies before issuance", async () => {
    const response = await POST(
      request(validBody(), { "content-length": String(5 * 1024) }),
    );
    expect(response.status).toBe(400);
    expect(mocks.issueManagerApprovalGrant).not.toHaveBeenCalled();
  });

  it("returns the raw token only on successful issuance", async () => {
    const expiresAt = new Date("2026-07-23T12:02:00.000Z");
    mocks.issueManagerApprovalGrant.mockResolvedValue({
      approvalToken: RAW_TOKEN,
      action: "order.discount",
      resourceType: "order",
      resourceId: 50,
      expiresAt,
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        approvalToken: RAW_TOKEN,
        action: "order.discount",
        resourceType: "order",
        resourceId: 50,
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(mocks.cleanupManagerApprovalGrants).toHaveBeenCalledOnce();
  });

  it("maps failed issuance to a generic error without returning a token", async () => {
    mocks.issueManagerApprovalGrant.mockRejectedValue(
      new ManagerApprovalServiceError("MANAGER_APPROVAL_FAILED", 403),
    );
    const response = await POST(request(validBody()));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: "Manager approval failed",
      code: "MANAGER_APPROVAL_FAILED",
    });
    expect(JSON.stringify(body)).not.toContain(RAW_TOKEN);
  });

  it("maps throttling with Retry-After", async () => {
    mocks.issueManagerApprovalGrant.mockRejectedValue(
      new ManagerApprovalServiceError(
        "MANAGER_APPROVAL_THROTTLED",
        429,
        60,
      ),
    );
    const response = await POST(request(validBody()));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({
      code: "MANAGER_APPROVAL_THROTTLED",
    });
  });

  it("maps unavailable issuance generically", async () => {
    mocks.issueManagerApprovalGrant.mockRejectedValue(
      new ManagerApprovalServiceError("MANAGER_APPROVAL_UNAVAILABLE", 503),
    );
    const response = await POST(request(validBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "MANAGER_APPROVAL_UNAVAILABLE",
    });
  });

  it("passes authoritative requester context into the issue service", async () => {
    mocks.issueManagerApprovalGrant.mockRejectedValue(
      new ManagerApprovalServiceError("MANAGER_APPROVAL_FAILED", 403),
    );
    await POST(request(validBody()));
    expect(mocks.issueManagerApprovalGrant).toHaveBeenCalledWith({
      requester: {
        userId: 2,
        sessionId: "mgr_approval_req_session_abcdefgh",
        authVersion: 1,
        terminalId: 1,
        permissions: ["Apply discounts:1"],
      },
      managerUserId: 7,
      managerPin: "4826",
      action: "order.discount",
      resourceType: "order",
      resourceId: 50,
      clientIp: "198.51.100.20",
    });
  });

  it("does not leak unexpected errors as tokens", async () => {
    mocks.issueManagerApprovalGrant.mockRejectedValue(new Error("boom"));
    const response = await POST(request(validBody()));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "MANAGER_APPROVAL_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toMatch(/approvalToken|boom/);
  });
});

function validBody() {
  return {
    managerUserId: 7,
    managerPin: "4826",
    action: "order.discount",
    resourceType: "order",
    resourceId: 50,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/manager-approvals", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
