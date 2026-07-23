import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import {
  ORDER_NOT_VOIDABLE,
  VOIDABLE_ORDER_STATUSES,
  assertOrderVoidable,
  isVoidableOrderStatus,
} from "@/lib/security/void-concurrency";
import { voidOrder } from "@/lib/services/order-service";
import {
  createIdempotencyTestDatabase,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

const NON_VOIDABLE = [
  "Packed",
  "OutForDelivery",
  "Delivered",
  "Closed",
  "Void",
] as const;

describe("void eligibility allowlist", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-eligibility");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("exports the exact Open|PartiallyPaid allowlist", () => {
    expect([...VOIDABLE_ORDER_STATUSES]).toEqual(["Open", "PartiallyPaid"]);
    expect(isVoidableOrderStatus("Open")).toBe(true);
    expect(isVoidableOrderStatus("PartiallyPaid")).toBe(true);
    for (const status of NON_VOIDABLE) {
      expect(isVoidableOrderStatus(status)).toBe(false);
    }
  });

  it("assertOrderVoidable matches the CAS allowlist", () => {
    expect(() => assertOrderVoidable("Open")).not.toThrow();
    expect(() => assertOrderVoidable("PartiallyPaid")).not.toThrow();
    for (const status of NON_VOIDABLE) {
      expect(() => assertOrderVoidable(status)).toThrow(ServiceError);
      try {
        assertOrderVoidable(status);
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe(ORDER_NOT_VOIDABLE);
        expect((error as ServiceError).status).toBe(409);
      }
    }
  });

  it("Open can be voided", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "Open",
    });
    const { token } = await issueVoidGrant(database.client, fixture, 200);
    await runVoidIdempotent(database.client, fixture, { token });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
  });

  it("PartiallyPaid can be voided", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "PartiallyPaid",
    });
    const { token } = await issueVoidGrant(database.client, fixture, 201);
    await runVoidIdempotent(database.client, fixture, { token });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
  });

  for (const status of NON_VOIDABLE) {
    it(`${status} cannot be voided`, async () => {
      const fixture = await seedVoidableOrderFixture(database.client, {
        status,
      });
      const { token } = await issueVoidGrant(database.client, fixture, 210);
      await expect(
        runVoidIdempotent(database.client, fixture, { token }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ServiceError &&
          error.code === ORDER_NOT_VOIDABLE &&
          error.status === 409,
      );
      const grant = await database.client.managerApprovalGrant.findFirstOrThrow({
        where: { resourceId: fixture.order.id, action: "order.void" },
      });
      expect(grant.consumedAt).toBeNull();
    });
  }

  it("direct voidOrder rejects Closed without mutating", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "Closed",
    });
    const { token } = await issueVoidGrant(database.client, fixture, 220);
    await expect(
      database.client.$transaction((tx) =>
        voidOrder(
          {
            orderId: fixture.order.id,
            reason: "nope",
            approvalToken: token,
            requester: fixture.requesterContext,
          },
          tx,
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError && error.code === ORDER_NOT_VOIDABLE,
    );
  });
});
