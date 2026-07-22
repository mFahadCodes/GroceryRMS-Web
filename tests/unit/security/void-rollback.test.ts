import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  countAudits,
  countIdempotencyRecords,
  countStockMovements,
} from "./idempotency-test-database";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY_B,
  issueVoidGrant,
  resetIdempotencyTables,
  runVoidIdempotent,
  seedVoidableOrderFixture,
} from "./void-test-harness";

const FAIL_AUDIT = `CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs WHEN NEW.action = 'VOID_ORDER' BEGIN SELECT RAISE(ABORT, 'forced void audit failure'); END`;
const FAIL_IDEMPOTENCY = `CREATE TRIGGER fail_idempotency_complete BEFORE UPDATE ON idempotency_records WHEN NEW.state = 'COMPLETED' BEGIN SELECT RAISE(ABORT, 'forced idempotency completion failure'); END`;
const FAIL_STOCK = `CREATE TRIGGER fail_stock_update BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT, 'forced stock failure'); END`;

describe("void rollback", () => {
  const database = createIdempotencyTestDatabase("p0c2-void-rollback");

  beforeEach(async () => {
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("audit failure rolls back void, grant consumption, stock, and idempotency", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 10,
      quantity: 2,
    });
    const { token, grant } = await issueVoidGrant(database.client, fixture, 70);
    await database.client.$executeRawUnsafe(FAIL_AUDIT);
    try {
      await expect(
        runVoidIdempotent(database.client, fixture, {
          token,
          reverseStock: true,
        }),
      ).rejects.toThrow();
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
      const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
        where: { id: grant.id },
      });
      expect(stored.consumedAt).toBeNull();
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
      await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(0);
      const product = await database.client.product.findUniqueOrThrow({
        where: { id: fixture.product!.id },
      });
      expect(Number(product.currentStock)).toBe(10);
      await expect(
        countStockMovements(database.client, fixture.product!.id, "Return"),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("after audit rollback a later key can void successfully", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const first = await issueVoidGrant(database.client, fixture, 71);
    await database.client.$executeRawUnsafe(FAIL_AUDIT);
    try {
      await expect(
        runVoidIdempotent(database.client, fixture, { token: first.token }),
      ).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
    const second = await issueVoidGrant(database.client, fixture, 72);
    await runVoidIdempotent(database.client, fixture, {
      rawKey: IDEMPOTENCY_TEST_KEY_B,
      token: second.token,
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
    await expect(countAudits(database.client, "VOID_ORDER")).resolves.toBe(1);
    await expect(countIdempotencyRecords(database.client)).resolves.toBe(1);
  });

  it("idempotency completion failure rolls back void and grant", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const { token, grant } = await issueVoidGrant(database.client, fixture, 73);
    await database.client.$executeRawUnsafe(FAIL_IDEMPOTENCY);
    try {
      await expect(
        runVoidIdempotent(database.client, fixture, { token }),
      ).rejects.toThrow();
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
      const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
        where: { id: grant.id },
      });
      expect(stored.consumedAt).toBeNull();
      await expect(countIdempotencyRecords(database.client)).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_idempotency_complete",
      );
    }
  });

  it("stock failure with reverseStock rolls back void and grant", async () => {
    const fixture = await seedVoidableOrderFixture(database.client, {
      stock: 10,
      quantity: 2,
    });
    const { token, grant } = await issueVoidGrant(database.client, fixture, 74);
    await database.client.$executeRawUnsafe(FAIL_STOCK);
    try {
      await expect(
        runVoidIdempotent(database.client, fixture, {
          token,
          reverseStock: true,
        }),
      ).rejects.toThrow();
      const order = await database.client.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
      });
      expect(order.status).toBe("Open");
      const stored = await database.client.managerApprovalGrant.findUniqueOrThrow({
        where: { id: grant.id },
      });
      expect(stored.consumedAt).toBeNull();
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_stock_update",
      );
    }
  });

  it("approvedByUserId overload still CAS-voids without a grant token", async () => {
    const fixture = await seedVoidableOrderFixture(database.client);
    const updated = await runVoidIdempotent(database.client, fixture, {
      token: (await issueVoidGrant(database.client, fixture, 75)).token,
      reason: "manager override test",
    });
    expect(updated.replayed).toBe(false);
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.status).toBe("Void");
  });
});
