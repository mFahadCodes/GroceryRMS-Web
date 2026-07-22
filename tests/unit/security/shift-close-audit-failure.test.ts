import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));

import { closeShift } from "../../../lib/services/shift-service";
import {
  createShiftCloseTestDatabase,
  resetShiftCloseTables,
  seedShiftCloseFixture,
} from "./shift-close-test-database";

describe("shift close audit failure", () => {
  const database = createShiftCloseTestDatabase("sec05c-audit-failure");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetShiftCloseTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("rolls back close when audit insert is aborted by a SQLite trigger", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
      notes: "open notes",
    });

    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );

    try {
      await expect(
        closeShift({
          shiftId: fixture.shift.id,
          userId: fixture.user.id,
          closingBalance: 12_000n,
          notes: "should not stick",
          auditAction: "SHIFT_CLOSE",
        }),
      ).rejects.toThrow();

      const shift = await database.client.shift.findUniqueOrThrow({
        where: { id: fixture.shift.id },
      });
      expect(shift.endedAt).toBeNull();
      expect(shift.closingBalance).toBe(0n);
      expect(shift.expectedBalance).toBe(0n);
      expect(shift.discrepancy).toBe(0n);
      expect(shift.notes).toBe("open notes");

      await expect(
        database.client.auditLog.count({
          where: {
            action: { in: ["SHIFT_CLOSE", "CLOSE_SHIFT"] },
          },
        }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("also rolls back CLOSE_SHIFT when the audit trigger fires", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 4_000n,
    });

    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );

    try {
      await expect(
        closeShift({
          shiftId: fixture.shift.id,
          userId: fixture.user.id,
          closingBalance: 4_000n,
          auditAction: "CLOSE_SHIFT",
        }),
      ).rejects.toThrow();

      const shift = await database.client.shift.findUniqueOrThrow({
        where: { id: fixture.shift.id },
      });
      expect(shift.endedAt).toBeNull();
      await expect(
        database.client.auditLog.count({ where: { action: "CLOSE_SHIFT" } }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });

  it("succeeds with exactly one audit after the failing trigger is removed", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 7_500n,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-55 (Cash)",
          amount: 250n,
        },
      ],
    });

    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 7_750n,
        auditAction: "SHIFT_CLOSE",
      }),
    ).rejects.toThrow();

    await database.client.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_audit_insert",
    );

    const closed = await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 7_750n,
      auditAction: "SHIFT_CLOSE",
    });

    expect(closed.endedAt).not.toBeNull();
    expect(closed.closingBalance).toBe(7_750n);
    expect(closed.expectedBalance).toBe(7_750n);
    expect(closed.discrepancy).toBe(0n);

    await expect(
      database.client.auditLog.count({ where: { action: "SHIFT_CLOSE" } }),
    ).resolves.toBe(1);
  });

  it("leaves balances at schema defaults after a failed close attempt", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 9_999n,
    });

    await database.client.$executeRawUnsafe(
      "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );

    try {
      await expect(
        closeShift({
          shiftId: fixture.shift.id,
          userId: fixture.user.id,
          closingBalance: 1n,
          auditAction: "CLOSE_SHIFT",
        }),
      ).rejects.toThrow();

      const shift = await database.client.shift.findUniqueOrThrow({
        where: { id: fixture.shift.id },
      });
      expect(shift.closingBalance).toBe(0n);
      expect(shift.expectedBalance).toBe(0n);
      expect(shift.discrepancy).toBe(0n);
      expect(shift.openingBalance).toBe(9_999n);
    } finally {
      await database.client.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_audit_insert",
      );
    }
  });
});
