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

describe("shift close retry", () => {
  const database = createShiftCloseTestDatabase("sec05c-retry");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetShiftCloseTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("throws already closed on an identical second close attempt", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
    });

    const input = {
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 10_000n,
      notes: "same payload",
      auditAction: "SHIFT_CLOSE" as const,
      auditIpAddress: "192.168.1.10",
    };

    const first = await closeShift(input);
    expect(first.endedAt).not.toBeNull();

    await expect(closeShift(input)).rejects.toThrow(/already closed/i);
  });

  it("does not write a second success audit on retry", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 4_500n,
    });

    const input = {
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 4_500n,
      auditAction: "CLOSE_SHIFT" as const,
    };

    await closeShift(input);
    await expect(closeShift(input)).rejects.toThrow(/already closed/i);

    await expect(
      database.client.auditLog.count({ where: { action: "CLOSE_SHIFT" } }),
    ).resolves.toBe(1);
  });

  it("leaves closedAt and totals unchanged after a failed retry", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 2_000n,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-r (Cash)",
          amount: 300n,
        },
      ],
    });

    const first = await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 2_250n,
      notes: "first close",
      auditAction: "SHIFT_CLOSE",
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 9_999n,
        notes: "retry overwrite attempt",
        auditAction: "SHIFT_CLOSE",
      }),
    ).rejects.toThrow(/already closed/i);

    const after = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(after.endedAt).toEqual(first.endedAt);
    expect(after.closingBalance).toBe(2_250n);
    expect(after.expectedBalance).toBe(2_300n);
    expect(after.discrepancy).toBe(-50n);
    expect(after.notes).toBe("first close");
  });

  it("rejects retry for both SHIFT_CLOSE and CLOSE_SHIFT action names", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 1_000n,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 1_000n,
      auditAction: "SHIFT_CLOSE",
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 1_000n,
        auditAction: "CLOSE_SHIFT",
      }),
    ).rejects.toThrow(/already closed/i);

    await expect(
      database.client.auditLog.count({
        where: { action: { in: ["SHIFT_CLOSE", "CLOSE_SHIFT"] } },
      }),
    ).resolves.toBe(1);
  });

  it("preserves the first audit metadata on retry", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 500n,
      terminalId: 1,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 500n,
      notes: "original",
      auditAction: "SHIFT_CLOSE",
    });

    const before = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SHIFT_CLOSE" },
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 700n,
        notes: "retry",
        auditAction: "SHIFT_CLOSE",
      }),
    ).rejects.toThrow(/already closed/i);

    const after = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SHIFT_CLOSE" },
    });
    expect(after.id).toBe(before.id);
    expect(after.newValues).toBe(before.newValues);
    expect(after.createdAt).toEqual(before.createdAt);
  });
});
