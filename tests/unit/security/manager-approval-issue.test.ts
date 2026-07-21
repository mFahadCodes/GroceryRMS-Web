import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  digestManagerApprovalToken,
  MANAGER_APPROVAL_LIFETIME_MS,
} from "../../../lib/security/manager-approval";
import {
  issueManagerApprovalGrant,
  ManagerApprovalServiceError,
} from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  DISCOUNT_PERM,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
  verifiedPinResult,
} from "./manager-approval-test-database";

describe("manager approval issuance", () => {
  const database = createManagerApprovalTestDatabase("sec02b-issue");
  const verifyPin = vi.fn();

  beforeEach(async () => {
    verifyPin.mockReset();
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("requires the requester base permission before PIN verification", async () => {
    const fixture = await seedManagerApprovalFixture(database.client, {
      requesterAccessLevel: 0,
    });
    fixture.requesterContext.permissions = [];
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "4826",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_FAILED",
      status: 403,
    });
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("verifies only the explicitly selected manager", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
    );
    await issueManagerApprovalGrant(
      {
        requester: fixture.requesterContext,
        managerUserId: fixture.manager.id,
        managerPin: "4826",
        action: "order.discount",
        resourceType: "order",
        resourceId: fixture.order.id,
        clientIp: "203.0.113.10",
      },
      database.client,
      {
        now: MANAGER_APPROVAL_NOW,
        verifyPin,
        generateToken: () => deterministicApprovalToken(1),
      },
    );
    expect(verifyPin.mock.calls[0]?.[0]).toMatchObject({
      userId: fixture.manager.id,
      pin: "4826",
      clientIp: "203.0.113.10",
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: 1,
    });
    expect(verifyPin.mock.calls[0]?.[1]).toBe(database.client);
  });

  it("returns a generic failure for an unverified manager PIN", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue({ status: "failed" });
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "0000",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toBeInstanceOf(ManagerApprovalServiceError);
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "0000",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED", status: 403 });
  });

  it("maps throttling to a generic throttled approval state", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue({
      status: "throttled",
      retryAfterSeconds: 45,
    });
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "4826",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_THROTTLED",
      status: 429,
      retryAfterSeconds: 45,
    });
  });

  it("maps security-unavailable PIN results generically", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue({ status: "security-unavailable" });
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "4826",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_UNAVAILABLE",
      status: 503,
    });
  });

  it("uses an exact 120 second TTL from the deterministic clock", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
    );
    const issued = await issueManagerApprovalGrant(
      {
        requester: fixture.requesterContext,
        managerUserId: fixture.manager.id,
        managerPin: "4826",
        action: "order.discount",
        resourceType: "order",
        resourceId: fixture.order.id,
        clientIp: "203.0.113.10",
      },
      database.client,
      {
        now: MANAGER_APPROVAL_NOW,
        verifyPin,
        generateToken: () => deterministicApprovalToken(2),
      },
    );
    expect(MANAGER_APPROVAL_LIFETIME_MS).toBe(120_000);
    expect(issued.expiresAt.getTime()).toBe(
      MANAGER_APPROVAL_NOW.getTime() + 120_000,
    );
  });

  it("returns the raw token from the issue service only and stores the digest", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const rawToken = deterministicApprovalToken(3);
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
    );
    const issued = await issueManagerApprovalGrant(
      {
        requester: fixture.requesterContext,
        managerUserId: fixture.manager.id,
        managerPin: "4826",
        action: "order.discount",
        resourceType: "order",
        resourceId: fixture.order.id,
        clientIp: "203.0.113.10",
      },
      database.client,
      {
        now: MANAGER_APPROVAL_NOW,
        verifyPin,
        generateToken: () => rawToken,
      },
    );
    expect(issued.approvalToken).toBe(rawToken);
    const grant = await database.client.managerApprovalGrant.findFirstOrThrow();
    expect(grant.tokenHash).toBe(digestManagerApprovalToken(rawToken));
    expect(JSON.stringify(grant)).not.toContain(rawToken);
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "MANAGER_APPROVAL_ISSUED" },
    });
    expect(audit.newValues).not.toContain(rawToken);
    expect(audit.newValues).not.toContain(grant.tokenHash);
  });

  it("rejects a malformed generated token without persisting a grant", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
    );
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "4826",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          clientIp: "203.0.113.10",
        },
        database.client,
        {
          now: MANAGER_APPROVAL_NOW,
          verifyPin,
          generateToken: () => "not-a-valid-token",
        },
      ),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_UNAVAILABLE",
      status: 503,
    });
    await expect(database.client.managerApprovalGrant.count()).resolves.toBe(0);
  });

  it("supports a self-approval lifecycle when one user holds both levels", async () => {
    const fixture = await seedManagerApprovalFixture(database.client, {
      selfApproval: true,
      managerAccessLevel: 4,
    });
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.requester.id, [`${DISCOUNT_PERM}:4`]),
    );
    const issued = await issueManagerApprovalGrant(
      {
        requester: fixture.requesterContext,
        managerUserId: fixture.requester.id,
        managerPin: "4826",
        action: "order.discount",
        resourceType: "order",
        resourceId: fixture.order.id,
        clientIp: "203.0.113.10",
      },
      database.client,
      {
        now: MANAGER_APPROVAL_NOW,
        verifyPin,
        generateToken: () => deterministicApprovalToken(4),
      },
    );
    const grant = await database.client.managerApprovalGrant.findFirstOrThrow();
    expect(issued.approvalToken).toBe(deterministicApprovalToken(4));
    expect(grant.requesterUserId).toBe(fixture.requester.id);
    expect(grant.approverUserId).toBe(fixture.requester.id);
  });

  it("fails closed when the order resource does not exist", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await expect(
      issueManagerApprovalGrant(
        {
          requester: fixture.requesterContext,
          managerUserId: fixture.manager.id,
          managerPin: "4826",
          action: "order.discount",
          resourceType: "order",
          resourceId: 999,
          clientIp: "203.0.113.10",
        },
        database.client,
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED", status: 403 });
    expect(verifyPin).not.toHaveBeenCalled();
  });
});
