import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import { ORDER_NOT_VOIDABLE } from "@/lib/security/void-concurrency";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("void idempotency", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-idempotency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("voids an open order once and records a completed idempotency row", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 1);
    const result = await runVoidIdempotent(database.client, fixture, { token });
    expect(result.replayed).toBe(false);
    expect(result.status).toBe(200);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
    expect(order.voidReason).toBe("customer cancelled");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).not.toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-voiding or re-consuming approval", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 2);
    await runVoidIdempotent(database.client, fixture, { token });
    const replay = await runVoidIdempotent(database.client, fixture, { token });
    expect(replay.replayed).toBe(true);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    await expect(
      countAudits(database.client, "MANAGER_APPROVAL_CONSUMED"),
    ).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).not.toBeNull();
  });

  it("same-key replay succeeds even when the original approval token is reused after consumption", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 3);
    await runVoidIdempotent(database.client, fixture, { token });
    const replay = await runVoidIdempotent(database.client, fixture, { token });
    expect(replay.replayed).toBe(true);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("same key with different reason is a payload mismatch", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 4);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reason: "reason-a",
    });
    await expect(
      runVoidIdempotent(database.client, fixture, {
        token,
        reason: "reason-b",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
  });

  it("same key with different reverseStock is a payload mismatch", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token } = await issueVoidGrant(database.client, fixture, 5);
    await runVoidIdempotent(database.client, fixture, {
      token,
      reverseStock: false,
    });
    await expect(
      runVoidIdempotent(database.client, fixture, {
        token,
        reverseStock: true,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("changing only the approval token does not change the request digest (replay still matches)", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const first = await issueVoidGrant(database.client, fixture, 6);
    await runVoidIdempotent(database.client, fixture, { token: first.token });
    const second = await issueVoidGrant(database.client, fixture, 7);
    const replay = await runVoidIdempotent(database.client, fixture, {
      token: second.token,
    });
    expect(replay.replayed).toBe(true);
    const secondGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: second.grant.id },
    });
    expect(secondGrant.consumedAt).toBeNull();
  });

  it("different key against an already voided order conflicts and leaves no second idempotency row", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const first = await issueVoidGrant(database.client, fixture, 8);
    await runVoidIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token: first.token,
    });
    const second = await issueVoidGrant(database.client, fixture, 9);
    await expect(
      runVoidIdempotent(database.client, fixture, {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: second.token,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof ServiceError &&
        error.code === ORDER_NOT_VOIDABLE &&
        error.status === 409
      );
    });
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    const secondGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: second.grant.id },
    });
    expect(secondGrant.consumedAt).toBeNull();
  });

  it("voids PartiallyPaid orders under current eligibility", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "PartiallyPaid",
    });
    const { token } = await issueVoidGrant(database.client, fixture, 10);
    await runVoidIdempotent(database.client, fixture, { token });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
  });

  it("rejects Closed orders under the approved Open|PartiallyPaid allowlist", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "Closed",
    });
    const { token, grant } = await issueVoidGrant(database.client, fixture, 11);
    await expect(
      runVoidIdempotent(database.client, fixture, { token }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError && error.code === ORDER_NOT_VOIDABLE,
    );
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Closed");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
  });
});
