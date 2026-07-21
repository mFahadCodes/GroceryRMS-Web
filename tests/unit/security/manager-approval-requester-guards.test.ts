import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeManagerApprovalGrant,
  issueManagerApprovalGrant,
} from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  insertGrant,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
  SESSION_EXPIRES_AT,
  verifiedPinResult,
} from "./manager-approval-test-database";

describe("manager approval requester lifecycle guards", () => {
  const database = createManagerApprovalTestDatabase("sec02b-requester");

  beforeEach(async () => {
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function readyGrant() {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(21);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      requesterAuthVersion: 1,
      approverUserId: fixture.manager.id,
      terminalId: 1,
    });
    return { fixture, token };
  }

  it("fails when the requester user is inactive", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.requester.id },
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

  it("fails when the requester must change password", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.requester.id },
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

  it("fails when the requester authVersion no longer matches the grant", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.user.update({
      where: { id: fixture.requester.id },
      data: { authVersion: 2 },
    });
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { authVersion: 2 },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: { ...fixture.requesterContext, authVersion: 2 },
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("fails when the requester session is inactive", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.userSession.update({
      where: { id: fixture.session.id },
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

  it("fails when the requester session has logged out", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { logoutAt: MANAGER_APPROVAL_NOW, isActive: false },
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

  it("fails when the requester session has expired", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { expiresAt: new Date(MANAGER_APPROVAL_NOW.getTime() - 1) },
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

  it("fails when the session authVersion drifts from the user authVersion", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { authVersion: 9 },
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

  it("fails when the requester terminal no longer matches the grant", async () => {
    const { fixture, token } = await readyGrant();
    await database.client.terminal.create({
      data: { id: 2, name: "Other terminal" },
    });
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { terminalId: 2 },
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: { ...fixture.requesterContext, terminalId: 2 },
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("also blocks issuance when the requester session is already expired", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: { expiresAt: new Date(MANAGER_APPROVAL_NOW.getTime() - 1_000) },
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
          verifyPin: async () =>
            verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
        },
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_FAILED" });
  });

  it("keeps a still-valid session eligible through the published expiry boundary", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    expect(SESSION_EXPIRES_AT.getTime()).toBeGreaterThan(
      MANAGER_APPROVAL_NOW.getTime(),
    );
    const token = deterministicApprovalToken(22);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
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
    ).resolves.toEqual({ approverUserId: fixture.manager.id });
  });
});
