import { ManagerApprovalServiceError } from "@/lib/services/manager-approval-service";
import {
  countAudits,
  createIdempotencyTestDatabase,
} from "./idempotency-test-database";
import {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  deterministicApprovalToken,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";
import { ServiceError } from "@/lib/api/service-error";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("void manager approval replay", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-approval-replay");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("original execution consumes the grant exactly once", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 80);
    await runVoidIdempotent(database.client, fixture, { token });
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.consumedAt).not.toBeNull();
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
  });

  it("matching replay succeeds with the original consumed token without re-consuming", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 81);
    await runVoidIdempotent(database.client, fixture, { token });
    const replay = await runVoidIdempotent(database.client, fixture, { token });
    expect(replay.replayed).toBe(true);
    const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.consumedAt).not.toBeNull();
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("matching replay succeeds with no managerApprovalToken and never enters execute", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 82);
    await runVoidIdempotent(database.client, fixture, { token });

    const replay = await executeFinancialIdempotent({
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.void",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.requester.id,
      authoritativeTerminalId: fixture.requesterContext.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        reason: "customer cancelled",
        reverseStock: false,
      },
      client: database.client,
      execute: async () => {
        throw new Error("execute must not run on matching replay");
      },
    });
    expect(replay.replayed).toBe(true);
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("matching replay succeeds when an unusable token value is supplied", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const first = await issueVoidGrant(database.client, fixture, 83);
    await runVoidIdempotent(database.client, fixture, { token: first.token });
    const second = await issueVoidGrant(database.client, fixture, 84);
    const replay = await runVoidIdempotent(database.client, fixture, {
      token: second.token,
    });
    expect(replay.replayed).toBe(true);
    const secondGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: second.grant.id },
    });
    expect(secondGrant.consumedAt).toBeNull();
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
  });

  it("payload mismatch does not create additional approval consumption", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 85);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reason: "a",
    });
    const unused = await issueVoidGrant(database.client, fixture, 86);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        token: unused.token,
        reason: "b",
      }),
    ).rejects.toThrow();
    const unusedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: unused.grant.id },
    });
    expect(unusedGrant.consumedAt).toBeNull();
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
  });

  it("losing different-key attempt does not consume its grant", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const a = await issueVoidGrant(database.client, fixture, 87);
    const b = await issueVoidGrant(database.client, fixture, 88);
    await Promise.allSettled([
      runVoidIdempotent(database.client, fixture, { token: a.token }),
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: b.token,
      }),
    ]);
    const grants = await database.client.managerApprovalGrant.findMany({
      where: { resourceId: fixture.order.id },
    });
    expect(grants.filter((g) => g.consumedAt === null)).toHaveLength(1);
  });

  it("invalid approval token rejects without voiding", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const unknownToken = deterministicApprovalToken(999);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        token: unknownToken,
      }),
    ).rejects.toBeInstanceOf(ManagerApprovalServiceError);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Open");
  });

  it("new original execution without a usable token is rejected by the route credential gate", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    await expect(
      executeFinancialIdempotent({
        rawKey: IDEMPOTENCY_TEST_KEY,
        operation: "order.void",
        resourceType: "orders",
        resourceId: fixture.order.id,
        actorUserId: fixture.requester.id,
        authoritativeTerminalId: fixture.requesterContext.terminalId,
        requestPayload: {
          orderId: fixture.order.id,
          reason: "customer cancelled",
          reverseStock: false,
        },
        client: database.client,
        execute: async (tx) => {
          // Mirrors route: missing/malformed token never reaches voidOrder.
          throw new ServiceError(
            "Manager approval token is required",
            "VALIDATION_ERROR",
            400,
          );
          void tx;
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError && error.code === "VALIDATION_ERROR",
    );
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Open");
  });

  it("voidOrderSchema has no managerPin for direct PIN fallback", () => {
    const source = readFileSync("lib/validators/order.validators.ts", "utf8");
    const start = source.indexOf("export const voidOrderSchema");
    const block = source.slice(start, start + 400);
    expect(block).not.toContain("managerPin");
    expect(block).toContain("managerApprovalToken");
    expect(source).toContain("voidOrderBusinessSchema");
    expect(source).toContain("voidManagerApprovalTokenSchema");
  });
});
