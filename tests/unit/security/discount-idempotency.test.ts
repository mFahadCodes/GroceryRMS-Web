import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";

describe("discount idempotency", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-idempotency");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("requires Idempotency-Key via executeFinancialIdempotent operation registration", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 1);
    const result = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 500n,
    });
    expect(result.replayed).toBe(false);
    expect(result.status).toBe(200);
  });

  it("applies a discount once and records a completed idempotency row", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 2);
    const result = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 1_000n,
    });
    expect(result.replayed).toBe(false);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(1_000n);
    expect(order.status).toBe("Open");
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).not.toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(1);
  });

  it("same-key replay returns stored success without re-mutating or re-consuming approval", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 3);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 800n,
    });
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 800n,
    });
    expect(replay.replayed).toBe(true);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(1);
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
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 4);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 700n,
    });
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 700n,
    });
    expect(replay.replayed).toBe(true);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(1);
  });

  it("same key with different discountAmount is a payload mismatch", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 5);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 500n,
    });
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 600n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(1);
  });

  it("same key with different reason is a payload mismatch", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 6);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 500n,
      reason: "reason-a",
    });
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 500n,
        reason: "reason-b",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("same key with different discountPercent is a payload mismatch", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 7);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountPercent: 10,
    });
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountPercent: 15,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("supports percent discount application", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 8);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountPercent: 10,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(1_000n);
  });

  it("allows zero discount reset while Open", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client, {
      discountAmount: 500n,
      grandTotal: 9_500n,
    });
    const { token } = await issueDiscountGrant(database.client, fixture, 9);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 0n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
  });

  it("same-key retry after first success does not create a second completed record", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 10);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 400n,
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 400n,
      rawKey: IDEMPOTENCY_TEST_KEY,
    });
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("leaves the order Open after a successful discount", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 11);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 250n,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Open");
    expect(order.grandTotal).toBe(fixture.order.grandTotal - 250n);
  });

  it("does not create payments or stock movements when applying a discount", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 12);
    await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 100n,
    });
    await expect(
      database.client.payment.count({ where: { orderId: fixture.order.id } }),
    ).resolves.toBe(0);
    await expect(database.client.stockMovement.count()).resolves.toBe(0);
  });

  it("records response snapshot data usable by matching replay", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 13);
    const first = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 350n,
    });
    const replay = await runDiscountIdempotent(database.client, fixture, {
      token,
      discountAmount: 350n,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe(first.status);
    expect(replay.responseBody).toEqual(first.responseBody);
  });
});