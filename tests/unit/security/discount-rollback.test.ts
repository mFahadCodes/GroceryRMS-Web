import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

const FAIL_AUDIT = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`;
const FAIL_IDEMPOTENCY = `CREATE TRIGGER fail_idempotency_complete BEFORE UPDATE ON idempotency_records WHEN NEW.state = 'COMPLETED' BEGIN SELECT RAISE(ABORT, 'forced idempotency completion failure'); END`;

describe("discount rollback", () => {
  const database = createIdempotencyTestDatabase("p0e-discount-rollback");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
    await database.client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_idempotency_complete",
    );
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("audit failure rolls back discount mutation and grant consumption", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 90);
    await database.client.$executeRawUnsafe(FAIL_AUDIT);

    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 400n,
      }),
    ).rejects.toBeTruthy();

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    await expect(
      countAudits(database.client, "APPLY_ORDER_DISCOUNT"),
    ).resolves.toBe(0);
  });

  it("idempotency completion failure rolls back discount and grant", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    const { token, grant } = await issueDiscountGrant(database.client, fixture, 91);
    await database.client.$executeRawUnsafe(FAIL_IDEMPOTENCY);

    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token,
        discountAmount: 400n,
      }),
    ).rejects.toBeTruthy();

    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_idempotency_complete",
    );

    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
    const storedGrant = await database.client.managerApprovalGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(storedGrant.consumedAt).toBeNull();
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
  });

  it("approval failure leaves no discount mutation", async () => {
    const fixture = await seedDiscountableOrderFixture(database.client);
    await expect(
      runDiscountIdempotent(database.client, fixture, {
        token: "ddddddddddddddddddddddddddddddddddddddddddd",
        discountAmount: 100n,
      }),
    ).rejects.toBeTruthy();
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.discountAmount).toBe(0n);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
  });
});
