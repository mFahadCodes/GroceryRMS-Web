import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getManagerApprovalActionConfiguration,
  MANAGER_APPROVAL_CLEANUP_BATCH_SIZE,
  MANAGER_APPROVAL_CLEANUP_RETENTION_MS,
  MANAGER_APPROVAL_LIFETIME_MS,
} from "../../../lib/security/manager-approval";
import {
  cleanupManagerApprovalGrants,
  consumeManagerApprovalGrant,
} from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  insertGrant,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("manager approval consume, replay, and cleanup", () => {
  const database = createManagerApprovalTestDatabase("sec02b-consume");

  beforeEach(async () => {
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("fails closed for an unknown action configuration", () => {
    expect(getManagerApprovalActionConfiguration("order.refund")).toBeNull();
  });

  it("fails closed for a removed action string at consume time", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(41);
    await insertGrant(database.client, {
      token,
      action: "order.refund",
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
          action: "order.refund" as "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("rejects a malformed approval token without lookup side effects", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: "bad",
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("rejects an unknown token digest", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: deterministicApprovalToken(42),
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_INVALID" });
  });

  it("enforces one-time replay with MANAGER_APPROVAL_ALREADY_USED", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(43);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    await database.client.$transaction((tx) =>
      consumeManagerApprovalGrant(tx, {
        requester: fixture.requesterContext,
        approvalToken: token,
        action: "order.discount",
        resourceType: "order",
        resourceId: fixture.order.id,
        now: MANAGER_APPROVAL_NOW,
      }),
    );
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: new Date(MANAGER_APPROVAL_NOW.getTime() + 1_000),
        }),
      ),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_ALREADY_USED",
      status: 409,
    });
  });

  it("rejects an expired grant with MANAGER_APPROVAL_EXPIRED", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(44);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      expiresAt: new Date(
        MANAGER_APPROVAL_NOW.getTime() + MANAGER_APPROVAL_LIFETIME_MS,
      ),
    });
    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: new Date(
            MANAGER_APPROVAL_NOW.getTime() + MANAGER_APPROVAL_LIFETIME_MS,
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_EXPIRED", status: 403 });
  });

  it("rejects a revoked grant as invalid", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(45);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      revokedAt: MANAGER_APPROVAL_NOW,
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

  it("uses an exact conditional update that requires unused unrevoked unexpired rows", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(46);
    const grant = await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    const first = await database.client.managerApprovalGrant.updateMany({
      where: {
        id: grant.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: MANAGER_APPROVAL_NOW },
      },
      data: { consumedAt: MANAGER_APPROVAL_NOW },
    });
    const second = await database.client.managerApprovalGrant.updateMany({
      where: {
        id: grant.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: MANAGER_APPROVAL_NOW },
      },
      data: { consumedAt: MANAGER_APPROVAL_NOW },
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
  });

  it("bounds cleanup to the configured retention and batch size", async () => {
    expect(MANAGER_APPROVAL_CLEANUP_BATCH_SIZE).toBe(100);
    expect(MANAGER_APPROVAL_CLEANUP_RETENTION_MS).toBe(24 * 60 * 60 * 1000);

    const fixture = await seedManagerApprovalFixture(database.client);
    const cutoff = new Date(
      MANAGER_APPROVAL_NOW.getTime() - MANAGER_APPROVAL_CLEANUP_RETENTION_MS,
    );
    const stale = new Date(cutoff.getTime() - 1_000);
    const fresh = new Date(MANAGER_APPROVAL_NOW.getTime() - 60_000);

    for (let index = 0; index < 101; index += 1) {
      await insertGrant(database.client, {
        token: deterministicApprovalToken(1_000 + index),
        resourceId: fixture.order.id,
        requesterUserId: fixture.requester.id,
        requesterSessionId: fixture.session.id,
        approverUserId: fixture.manager.id,
        expiresAt: stale,
        createdAt: stale,
      });
    }
    await insertGrant(database.client, {
      token: deterministicApprovalToken(2_000),
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      expiresAt: fresh,
      createdAt: fresh,
    });
    await insertGrant(database.client, {
      token: deterministicApprovalToken(2_001),
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      expiresAt: new Date(MANAGER_APPROVAL_NOW.getTime() + 60_000),
      consumedAt: stale,
      createdAt: stale,
    });
    await insertGrant(database.client, {
      token: deterministicApprovalToken(2_002),
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      expiresAt: new Date(MANAGER_APPROVAL_NOW.getTime() + 60_000),
      revokedAt: stale,
      createdAt: stale,
    });

    const deleted = await cleanupManagerApprovalGrants(
      database.client,
      MANAGER_APPROVAL_NOW,
    );
    expect(deleted).toBe(100);
    await expect(database.client.managerApprovalGrant.count()).resolves.toBe(4);

    const deletedAgain = await cleanupManagerApprovalGrants(
      database.client,
      MANAGER_APPROVAL_NOW,
    );
    expect(deletedAgain).toBe(3);
    await expect(database.client.managerApprovalGrant.count()).resolves.toBe(1);
  });

  it("returns zero when cleanup has nothing eligible", async () => {
    await expect(
      cleanupManagerApprovalGrants(database.client, MANAGER_APPROVAL_NOW),
    ).resolves.toBe(0);
  });
});
