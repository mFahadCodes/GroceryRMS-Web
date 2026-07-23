import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGER_APPROVAL_LIFETIME_MS } from "@/lib/security/manager-approval";
import { consumeManagerApprovalGrant } from "@/lib/services/manager-approval-service";
import {
  createManagerApprovalTestDatabase,
  deterministicApprovalToken,
  grantExpiryBoundary,
  insertGrant,
  installManagerApprovalTestClock,
  justBeforeGrantExpiry,
  MANAGER_APPROVAL_NOW,
  seedManagerApprovalFixture,
  validGrantExpiresAt,
  VOID_PERM,
} from "./manager-approval-test-database";

describe("manager approval test clock", () => {
  const database = createManagerApprovalTestDatabase("mgr-approval-clock");
  installManagerApprovalTestClock();

  beforeEach(async () => {
    await database.client.managerApprovalGrant.deleteMany();
    await database.client.auditLog.deleteMany();
    await database.client.orderItem.deleteMany();
    await database.client.order.deleteMany();
    await database.client.userSession.deleteMany();
    await database.client.user.deleteMany();
    await database.client.rolePermission.deleteMany();
    await database.client.permission.deleteMany();
    await database.client.role.deleteMany();
    await database.client.terminal.deleteMany();
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function seedVoidGrantFixture() {
    const fixture = await seedManagerApprovalFixture(database.client, {
      permissionName: VOID_PERM,
      managerAccessLevel: 5,
      requesterAccessLevel: 1,
    });
    fixture.requesterContext.permissions = [`${VOID_PERM}:1`];
    return fixture;
  }

  it("Date.now matches MANAGER_APPROVAL_NOW while the clock is installed", () => {
    expect(Date.now()).toBe(MANAGER_APPROVAL_NOW.getTime());
    expect(new Date().getTime()).toBe(MANAGER_APPROVAL_NOW.getTime());
  });

  it("a newly issued default grant is valid immediately under wall-clock consume", async () => {
    const fixture = await seedVoidGrantFixture();
    const token = deterministicApprovalToken(1);
    await insertGrant(database.client, {
      token,
      action: "order.void",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      requiredPermission: VOID_PERM,
      requiredAccessLevel: 5,
      terminalId: fixture.requesterContext.terminalId,
    });

    await database.client.$transaction((tx) =>
      consumeManagerApprovalGrant(tx, {
        requester: fixture.requesterContext,
        approvalToken: token,
        action: "order.void",
        resourceType: "order",
        resourceId: fixture.order.id,
      }),
    );

    const grant = await database.client.managerApprovalGrant.findFirstOrThrow({
      where: { resourceId: fixture.order.id },
    });
    expect(grant.consumedAt).not.toBeNull();
  });

  it("a grant remains valid just before the 120-second boundary", async () => {
    const fixture = await seedVoidGrantFixture();
    const token = deterministicApprovalToken(2);
    const issuedAt = MANAGER_APPROVAL_NOW;
    await insertGrant(database.client, {
      token,
      action: "order.void",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      requiredPermission: VOID_PERM,
      requiredAccessLevel: 5,
      terminalId: fixture.requesterContext.terminalId,
      createdAt: issuedAt,
      expiresAt: validGrantExpiresAt(issuedAt),
    });

    await database.client.$transaction((tx) =>
      consumeManagerApprovalGrant(tx, {
        requester: fixture.requesterContext,
        approvalToken: token,
        action: "order.void",
        resourceType: "order",
        resourceId: fixture.order.id,
        now: justBeforeGrantExpiry(issuedAt),
      }),
    );

    const grant = await database.client.managerApprovalGrant.findFirstOrThrow({
      where: { resourceId: fixture.order.id },
    });
    expect(grant.consumedAt?.getTime()).toBe(
      justBeforeGrantExpiry(issuedAt).getTime(),
    );
  });

  it("a grant is expired at and after the 120-second boundary", async () => {
    const fixture = await seedVoidGrantFixture();
    const token = deterministicApprovalToken(3);
    const issuedAt = MANAGER_APPROVAL_NOW;
    await insertGrant(database.client, {
      token,
      action: "order.void",
      resourceId: fixture.order.id,
      requesterUserId: fixture.requester.id,
      requesterSessionId: fixture.session.id,
      approverUserId: fixture.manager.id,
      requiredPermission: VOID_PERM,
      requiredAccessLevel: 5,
      terminalId: fixture.requesterContext.terminalId,
      createdAt: issuedAt,
      expiresAt: validGrantExpiresAt(issuedAt),
    });

    await expect(
      database.client.$transaction((tx) =>
        consumeManagerApprovalGrant(tx, {
          requester: fixture.requesterContext,
          approvalToken: token,
          action: "order.void",
          resourceType: "order",
          resourceId: fixture.order.id,
          now: grantExpiryBoundary(issuedAt),
        }),
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_EXPIRED", status: 403 });
  });

  it("lifetime helpers preserve the production 120-second window", () => {
    expect(MANAGER_APPROVAL_LIFETIME_MS).toBe(120_000);
    expect(
      validGrantExpiresAt(MANAGER_APPROVAL_NOW).getTime() -
        MANAGER_APPROVAL_NOW.getTime(),
    ).toBe(120_000);
  });
});

describe("manager approval test clock isolation", () => {
  it("restores the real clock outside suites that install the fake Date clock", () => {
    const wall = Date.now();
    expect(Math.abs(wall - Date.now())).toBeLessThan(2_000);
    // Must not remain stuck at the frozen reference instant.
    expect(Date.now()).not.toBe(MANAGER_APPROVAL_NOW.getTime());
  });

  it("source regression: default insertGrant expiry is not a frozen calendar literal", () => {
    const source = readFileSync(
      path.resolve("tests/unit/security/manager-approval-test-database.ts"),
      "utf8",
    );
    expect(source).toContain("installManagerApprovalTestClock");
    expect(source).toContain('toFake: ["Date"]');
    expect(source).toContain("validGrantExpiresAt()");
    expect(source).toContain("createdAt: input.createdAt ?? new Date()");
    expect(source).not.toMatch(
      /expiresAt:\s*input\.expiresAt\s*\?\?\s*new Date\(\s*MANAGER_APPROVAL_NOW\.getTime\(\)/,
    );
  });

  it("source regression: void harness installs the Date-only test clock", () => {
    const source = readFileSync(
      path.resolve("tests/unit/security/void-test-harness.ts"),
      "utf8",
    );
    expect(source).toContain("installManagerApprovalTestClock()");
  });

  it("does not leave fake timers active after an isolated Date-only install", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MANAGER_APPROVAL_NOW);
    expect(Date.now()).toBe(MANAGER_APPROVAL_NOW.getTime());
    vi.useRealTimers();
    expect(Date.now()).not.toBe(MANAGER_APPROVAL_NOW.getTime());
  });
});
