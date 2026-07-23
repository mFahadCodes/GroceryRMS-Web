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
  countAudits,
  countIdempotencyRecords,
  countPayments,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

const NON_VOIDABLE = [
  "PartiallyPaid",
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

  it("exports the exact Open-only allowlist", () => {
    expect([...VOIDABLE_ORDER_STATUSES]).toEqual(["Open"]);
    expect(isVoidableOrderStatus("Open")).toBe(true);
    for (const status of NON_VOIDABLE) {
      expect(isVoidableOrderStatus(status)).toBe(false);
    }
  });

  it("assertOrderVoidable matches the CAS allowlist", () => {
    expect(() => assertOrderVoidable("Open")).not.toThrow();
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

  for (const status of NON_VOIDABLE) {
    it(`${status} cannot be voided`, async () => {
      const fixture = await seedVoidableOrderFixture(database.client, {
        status,
      });
      const { token, grant } = await issueVoidGrant(database.client, fixture, 210);
      await expect(
        runVoidIdempotent(database.client, fixture, { token }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ServiceError &&
          error.code === ORDER_NOT_VOIDABLE &&
          error.status === 409,
      );
      const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
        where: { id: grant.id },
      });
      expect(storedGrant.consumedAt).toBeNull();
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    });
  }

  it("PartiallyPaid sequential void leaves payments and grant untouched", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      status: "PartiallyPaid",
      grandTotal: 10_000n,
    });
    await database.client.paymentMethod.create({
      data: { id: 1, name: "Cash", code: "CASH" },
    });
    await database.client.payment.create({
      data: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 4_000n,
        tenderedAmount: 4_000n,
        changeAmount: 0n,
        status: "Partial",
      },
    });
    const { token, grant } = await issueVoidGrant(database.client, fixture, 230);
    await expect(
      runVoidIdempotent(database.client, fixture, { token }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceError && error.code === ORDER_NOT_VOIDABLE,
    );

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("PartiallyPaid");
    await expect(countPayments(database.client, fixture.order.id)).resolves.toBe(1);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
    const voidCompleted = await database.client.idempotencyRecord.count({
      where: { operation: "order.void", state: "Completed" },
    });
    expect(voidCompleted).toBe(0);
  });

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
