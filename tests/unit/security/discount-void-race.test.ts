import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PERMS } from "@/lib/api/permissions";
import { ORDER_NOT_DISCOUNTABLE } from "@/lib/security/discount-concurrency";
import {
  countAudits,
  countIdempotencyRecords,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  issueDiscountGrant,
  resetIdempotencyTables,
  runDiscountIdempotent,
  seedDiscountableOrderFixture,
} from "./discount-test-harness";
import {
  issueVoidGrant,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

describe("discount versus void races", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-void");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("when void wins first, discount loses", async () => {
    const discountFixture = await seedDiscountableOrderFixture(database.client, {
      status: "Void",
    });
    const { token, grant } = await issueDiscountGrant(
      database.client,
      discountFixture,
      61,
    );
    await expect(
      runDiscountIdempotent(database.client, discountFixture, {
        rawKey: IDEMPOTENCY_TEST_KEY,
        token,
        discountAmount: 100n,
      }),
    ).rejects.toMatchObject({ code: ORDER_NOT_DISCOUNTABLE, status: 409 });
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });

  it("when discount wins first, later void may proceed while Open", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token } = await issueDiscountGrant(database.client, fixture, 62);
    await runDiscountIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY,
      token,
      discountAmount: 500n,
    });

    await database.client.permission.create({
      data: { id: 9, name: PERMS.VOID_ORDERS },
    });
    await database.client.rolePermission.create({
      data: { roleId: 1, permissionId: 9, accessLevel: 1 },
    });
    await database.client.rolePermission.create({
      data: { roleId: 2, permissionId: 9, accessLevel: 5 },
    });
    fixture.requesterContext.permissions = [
      ...fixture.requesterContext.permissions,
      `${PERMS.VOID_ORDERS}:1`,
    ];

    const voidLike = {
      ...fixture,
      product: fixture.product,
      quantity: fixture.quantity,
      stock: 20,
    };
    const { token: voidToken } = await issueVoidGrant(
      database.client,
      voidLike as Awaited<ReturnType<typeof seedVoidableOrderFixture>>,
      63,
    );
    await runVoidIdempotent(
      database.client,
      voidLike as Awaited<ReturnType<typeof seedVoidableOrderFixture>>,
      {
        rawKey: IDEMPOTENCY_TEST_KEY_B,
        token: voidToken,
      },
    );

    const voided = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(voided.status).toBe("Void");
    expect(voided.discountAmount).toBe(500n);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(2);
  });
});
