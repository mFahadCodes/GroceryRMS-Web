import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeManagerApprovalGrant,
} from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  DISCOUNT_PERM,
  insertGrant,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
  VOID_PERM,
} from "./manager-approval-test-database";

describe("manager approval action and resource binding", () => {
  const database = createManagerApprovalTestDatabase("sec02b-binding");

  beforeEach(async () => {
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function seedAndGrant(
    overrides: Partial<Parameters<typeof insertGrant>[1]> = {},
  ) {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(11);
    const grant = await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      terminalId: fixture.session.terminalId,
      ...overrides,
    });
    return { fixture, token, grant };
  }

  it("rejects a token presented for a different action", async () => {
    const { fixture, token } = await seedAndGrant({ action: "order.discount" });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.void",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID", status: 403 });
  });

  it("rejects a token presented for a different resource id", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const other = await database.client.order.create({
      data: {
        id: 51,
        orderNumber: "ORD-51",
        orderType: "WalkIn",
        status: "Open",
        cashierId: fixture.requester.id,
      },
    });
    const token = deterministicApprovalToken(12);
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
          resourceId: other.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("rejects a token presented for a different resource type", async () => {
    const { fixture, token } = await seedAndGrant({
      resourceType: "invoice",
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

  it("rejects a token bound to a different requester user", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await database.client.user.create({
      data: {
        id: 3,
        username: "other",
        fullName: "Other",
        passwordHash: "hash",
        roleId: 1,
      },
    });
    const token = deterministicApprovalToken(14);
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
          requester: {
            ...fixture.requesterContext,
            userId: 3,
          },
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("rejects a token when the requester session identity no longer matches", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const otherSession = await database.client.userSession.create({
      data: {
        sessionId: "mgr_approval_other_session_abcdef",
        userId: fixture.requester.id,
        terminalId: 1,
        authVersion: 1,
        expiresAt: new Date("2026-07-24T12:00:00.000Z"),
      },
    });
    const token = deterministicApprovalToken(15);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: otherSession.id,
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
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("rejects a token when required permission metadata drifts", async () => {
    const { fixture, token } = await seedAndGrant({
      requiredPermission: VOID_PERM,
      requiredAccessLevel: 5,
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

  it("rejects a token when required access level metadata drifts", async () => {
    const { fixture, token } = await seedAndGrant({
      requiredPermission: DISCOUNT_PERM,
      requiredAccessLevel: 5,
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

  it("consumes a correctly bound grant exactly once", async () => {
    const { fixture, token, grant } = await seedAndGrant();
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
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.consumedAt?.getTime()).toBe(MANAGER_APPROVAL_NOW.getTime());
  });
});
