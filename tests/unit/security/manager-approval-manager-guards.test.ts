import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeManagerApprovalGrant,
  issueManagerApprovalGrant,
} from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  DISCOUNT_PERM,
  insertGrant,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
  verifiedPinResult,
} from "./manager-approval-test-database";

describe("manager approval manager lifecycle guards", () => {
  const database = createManagerApprovalTestDatabase("sec02b-manager");
  const verifyPin = vi.fn();

  beforeEach(async () => {
    verifyPin.mockReset();
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function readyGrant() {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(31);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      approverAuthVersion: 1,
    });
    return { fixture, token };
  }

  it("fails consume when the manager is inactive", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.manager.id },
      data: { isActive: false },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails consume when the manager role is inactive", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.role.update({
      where: { id: 2 },
      data: { isActive: false },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails consume when the manager must rotate password", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.manager.id },
      data: { mustChangePassword: true },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails consume when the manager authVersion changed after issuance", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.manager.id },
      data: { authVersion: 4 },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails consume when the manager no longer has the current permission", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.rolePermission.deleteMany({ where: { roleId: 2 } });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails issue when a verified manager lacks the required access level", async () => {
    const fixture = await seedManagerApprovalFixture(database.client, {
      managerAccessLevel: 4,
    });
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, [`${DISCOUNT_PERM}:3`]),
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
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED" });
  });

  it("fails issue when a verified manager must change password", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockResolvedValue(
      verifiedPinResult(fixture.manager.id, fixture.managerPermissions, {
        mustChangePassword: true,
      }),
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
        { now: MANAGER_APPROVAL_NOW, verifyPin },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED" });
  });

  it("fails issue when the manager becomes inactive between PIN verify and persist", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    verifyPin.mockImplementation(async () => {
      await database.client.user.update({
        where: { id: fixture.manager.id },
        data: { isActive: false },
      });
      return verifiedPinResult(fixture.manager.id, fixture.managerPermissions);
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
        {
          now: MANAGER_APPROVAL_NOW,
          verifyPin,
          generateToken: () => deterministicApprovalToken(32),
        },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED" });
    await expect(database.client.managerApprovalGrant.count()).resolves.toBe(0);
  });
});
