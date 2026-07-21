import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));

import {
  applyOrderDiscount,
  voidOrder,
} from "../../../lib/services/order-service";
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
  verifiedPinResult,
} from "./manager-approval-test-database";

describe("manager approval transactional and concurrent behavior", () => {
  const database = createManagerApprovalTestDatabase("sec02b-tx");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_discount_audit",
    );
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_void_update",
    );
    await resetManagerApprovalTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("rolls back discount mutation and leaves the grant unconsumed on business failure", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(61);
    const grant = await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_discount_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'APPLY_ORDER_DISCOUNT' BEGIN SELECT RAISE(ABORT, 'test discount failure'); END",
    );
    try {
      await expect(
        applyOrderDiscount({
          orderId: fixture.order.id,
          discountPercent: 5,
          approvalToken: token,
          requester: fixture.requesterContext,
        }),
      ).rejects.toThrow();
      const stored = await database.client.managerApprovalGrant.findUniqueOrThrow(
        {
          where: { id: grant.id },
        },
      );
      expect(stored.consumedAt).toBeNull();
      await expect(
        database.client.order.findUnique({
          where: { id: fixture.order.id },
          select: { discountAmount: true },
        }),
      ).resolves.toEqual({ discountAmount: 0n });
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_discount_audit",
      );
    }
  });

  it("preserves the legacy level-four approver check pending SEC-04", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    await expect(
      applyOrderDiscount({
        orderId: fixture.order.id,
        discountPercent: 5,
        approvedByUserId: fixture.requester.id,
      }),
    ).rejects.toThrow("Approver does not have discount permission");
    await expect(
      database.client.order.findUnique({
        where: { id: fixture.order.id },
        select: { discountAmount: true },
      }),
    ).resolves.toEqual({ discountAmount: 0n });
  });

  it("rolls back void mutation and leaves the grant unconsumed on business failure", async () => {
    const fixture = await seedManagerApprovalFixture(database.client, {
      permissionName: "Void / cancel orders",
      managerAccessLevel: 5,
      orderId: 70,
    });
    fixture.requesterContext.permissions = ["Void / cancel orders:1"];
    const token = deterministicApprovalToken(62);
    const grant = await insertGrant(database.client, {
      token,
      action: "order.void",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      requiredPermission: "Void / cancel orders",
      requiredAccessLevel: 5,
    });
    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_void_update BEFORE UPDATE ON orders WHEN NEW.status = 'Void' BEGIN SELECT RAISE(ABORT, 'test void failure'); END",
    );
    try {
      await expect(
        voidOrder({
          orderId: fixture.order.id,
          reason: "test void",
          approvalToken: token,
          requester: fixture.requesterContext,
        }),
      ).rejects.toThrow();
      const stored = await database.client.managerApprovalGrant.findUniqueOrThrow(
        {
          where: { id: grant.id },
        },
      );
      expect(stored.consumedAt).toBeNull();
      await expect(
        database.client.order.findUnique({
          where: { id: fixture.order.id },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "Open" });
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_void_update",
      );
    }
  });

  it("allows only one concurrent consumer of the same token to mutate and audit success", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(63);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
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
      ),
    );

    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures.length).toBe(7);
    await expect(
      database.client.managerApprovalGrant.count({
        where: { consumedAt: { not: null } },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.auditLog.count({
        where: { action: "MANAGER_APPROVAL_CONSUMED" },
      }),
    ).resolves.toBe(1);
  });

  it("fails concurrent consume after requester session revocation", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(64);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });

    await database.client.userSession.update({
      where: { id: fixture.session.id },
      data: {
        isActive: false,
        logoutAt: MANAGER_APPROVAL_NOW,
        revokedReason: "logout",
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
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
      ),
    );

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await expect(
      database.client.managerApprovalGrant.count({
        where: { consumedAt: { not: null } },
      }),
    ).resolves.toBe(0);
  });

  it("fails concurrent consume after manager authVersion changes", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(65);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      approverAuthVersion: 1,
    });

    await database.client.user.update({
      where: { id: fixture.manager.id },
      data: { authVersion: 2 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
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
      ),
    );

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    const grant = await database.client.managerApprovalGrant.findFirstOrThrow();
    expect(grant.consumedAt).toBeNull();
  });

  it("leaves the grant unconsumed when a failed business transaction aborts after consume", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
    const token = deterministicApprovalToken(66);
    const grant = await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      requesterAuthVersion: fixture.requester.authVersion,
      approverUserId: fixture.manager.id,
      approverAuthVersion: fixture.manager.authVersion,
      terminalId: fixture.session.terminalId,
    });

    let consumedInsideTransaction = false;
    await expect(
      database.client.$transaction(async (tx) => {
        await consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.discount",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: MANAGER_APPROVAL_NOW,
        });
        consumedInsideTransaction = true;
        throw new Error("business failure after consume");
      }),
    ).rejects.toThrow("business failure after consume");
    expect(consumedInsideTransaction).toBe(true);

    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.consumedAt).toBeNull();
    await expect(
      database.client.auditLog.count({
        where: { action: "MANAGER_APPROVAL_CONSUMED" },
      }),
    ).resolves.toBe(0);
  });

  it("issues successfully into the disposable database through the service path", async () => {
    const fixture = await seedManagerApprovalFixture(database.client);
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
        verifyPin: async () =>
          verifiedPinResult(fixture.manager.id, fixture.managerPermissions),
        generateToken: () => deterministicApprovalToken(67),
      },
    );
    expect(issued.approvalToken).toBe(deterministicApprovalToken(67));
    await expect(database.client.managerApprovalGrant.count()).resolves.toBe(1);
  });
});
