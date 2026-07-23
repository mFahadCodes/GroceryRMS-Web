import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import {
  ORDER_NOT_DISCOUNTABLE,
} from "@/lib/security/discount-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";

describe("discount status eligibility", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-eligibility");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  async function expectNotDiscountable(
    status:
      | "PartiallyPaid"
      | "Packed"
      | "OutForDelivery"
      | "Delivered"
      | "Closed"
      | "Void",
    seed: number,
  ) {
    const fixture = await seedDiscountableOrderFixture(database.client, {
      status,
    });
    const { token, grant } = await issueDiscountGrant(
      database.client,
      fixture,
      seed,
    );
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 100n,
      }),
    ).rejects.toMatchObject({
      code: ORDER_NOT_DISCOUNTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe(status);
    expect(order.discountAmount).toBe(0n);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  }

  it("Open order can receive a discount", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client, {
      status: "Open",
    });
    const { token } = await issueDiscountGrant(database.client, fixture, 20);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 250n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(250n);
  });

  it("PartiallyPaid order cannot receive a discount", async () => {
    await expectNotDiscountable("PartiallyPaid", 21);
  });

  it("Packed order cannot receive a discount", async () => {
    await expectNotDiscountable("Packed", 22);
  });

  it("OutForDelivery order cannot receive a discount", async () => {
    await expectNotDiscountable("OutForDelivery", 23);
  });

  it("Delivered order cannot receive a discount", async () => {
    await expectNotDiscountable("Delivered", 24);
  });

  it("Closed order cannot receive a discount", async () => {
    await expectNotDiscountable("Closed", 25);
  });

  it("Void order cannot receive a discount", async () => {
    await expectNotDiscountable("Void", 26);
  });
});
