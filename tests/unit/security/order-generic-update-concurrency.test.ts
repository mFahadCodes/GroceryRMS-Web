import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));
vi.mock("@/lib/api/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

import { PUT } from "../../../app/api/orders/[id]/route";
import { consumeManagerApprovalGrant } from "../../../lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  insertGrant,
  MANAGER_APPROVAL_NOW,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

type Fixture = Awaited<ReturnType<typeof seedManagerApprovalFixture>>;

function request(body: unknown) {
  return new NextRequest("http://localhost/api/orders/50", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "50" }) };

describe("generic order update concurrency boundary", () => {
  const database = createManagerApprovalTestDatabase("sec04a-concurrency");
  let fixture: Fixture;

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetManagerApprovalTables(database.client);
    fixture = await seedManagerApprovalFixture(database.client);
    mocks.requirePermission.mockResolvedValue({
      session: {
        user: {
          id: fixture.requester.id,
          permissions: ["Create & process orders:1"],
        },
      },
    });
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("concurrent safe metadata updates settle to one submitted note without protected changes", async () => {
    const notes = Array.from({ length: 6 }, (_, index) => `note ${index}`);
    const results = await Promise.allSettled(
      notes.map((note) =>
        PUT(request({ action: "updateMeta", notes: note }), context),
      ),
    );
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value.status).toBe(200);
      }
    }
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(notes).toContain(order.notes);
    expect(order.status).toBe("Open");
    expect(order.discountAmount).toBe(0n);
    expect(order.grandTotal).toBe(10_000n);
    const privileged = await database.client.auditLog.count({
      where: {
        action: {
          in: ["HOLD_ORDER", "RECALL_ORDER", "VOID_ORDER", "APPLY_ORDER_DISCOUNT"],
        },
      },
    });
    expect(privileged).toBe(0);
  });

  it("concurrent rejected privileged payloads remain non-mutating", async () => {
    const payloads = [
      { action: "updateMeta", notes: "a", discountAmount: 9_000 },
      { action: "updateMeta", notes: "b", status: "Void" },
      { action: "updateMeta", notes: "c", managerPin: "4826" },
      { action: "updateMeta", notes: "d", adjustment: -1 },
    ];
    const before = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const responses = await Promise.all(
      payloads.map((payload) => PUT(request(payload), context)),
    );
    for (const response of responses) {
      expect(response.status).toBe(400);
    }
    const after = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(after).toEqual(before);
    await expect(database.client.auditLog.count()).resolves.toBe(0);
  });

  it("cannot race the generic route against itself to trigger protected behavior", async () => {
    const mixed = [
      { action: "updateMeta", notes: "void: race" },
      { action: "updateMeta", notes: "hold" },
      { action: "updateMeta", notes: "recall" },
      { action: "updateMeta", notes: "plain" },
      { action: "updateMeta", notes: "x", discountPercent: 90 },
    ];
    await Promise.allSettled(
      mixed.map((payload) => PUT(request(payload), context)),
    );
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Open");
    expect(order.voidReason).toBeNull();
    expect(order.discountAmount).toBe(0n);
    expect(order.approvedByUserId).toBeNull();
  });

  it("a concurrently consumed manager grant does not influence the generic route", async () => {
    const token = deterministicApprovalToken(91);
    await insertGrant(database.client, {
      token,
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
    });
    fixture.requesterContext.permissions = ["Apply discounts:1"];

    const [consumeResult, ...genericResults] = await Promise.allSettled([
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
      PUT(
        request({ action: "updateMeta", notes: "concurrent with consume" }),
        context,
      ),
      PUT(
        request({
          action: "updateMeta",
          notes: "n",
          managerApprovalToken: token,
        }),
        context,
      ),
    ]);

    expect(consumeResult.status).toBe("fulfilled");
    const [safeUpdate, tokenSmuggle] = genericResults;
    expect(safeUpdate.status).toBe("fulfilled");
    if (safeUpdate.status === "fulfilled") {
      expect((safeUpdate.value as Response).status).toBe(200);
    }
    expect(tokenSmuggle.status).toBe("fulfilled");
    if (tokenSmuggle.status === "fulfilled") {
      expect((tokenSmuggle.value as Response).status).toBe(400);
    }

    await expect(
      database.client.managerApprovalGrant.count({
        where: { consumedAt: { not: null } },
      }),
    ).resolves.toBe(1);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    // The dedicated consumption path only consumed the grant; the generic
    // route neither applied a discount nor gained authority from it.
    expect(order.discountAmount).toBe(0n);
    expect(order.status).toBe("Open");
  });
});
