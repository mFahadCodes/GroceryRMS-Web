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

describe("shift close concurrency", () => {
  const database = createShiftCloseTestDatabase("sec05c-concurrency");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetShiftCloseTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("allows only one of two concurrent closes to succeed", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
    });

    const results = await Promise.allSettled([
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 10_100n,
        auditAction: "SHIFT_CLOSE",
      }),
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 10_900n,
        auditAction: "SHIFT_CLOSE",
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedResult = rejected[0];
    expect(rejectedResult?.status).toBe("rejected");
    if (rejectedResult?.status === "rejected") {
      expect(String(rejectedResult.reason)).toMatch(/already closed/i);
    }
  });

  it("persists the winning closingBalance and does not overwrite with the loser", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 8_000n,
    });

    const balances = [8_111n, 8_999n] as const;
    const results = await Promise.allSettled(
      balances.map((closingBalance) =>
        closeShift({
          shiftId: fixture.shift.id,
          userId: fixture.user.id,
          closingBalance,
          auditAction: "CLOSE_SHIFT",
        }),
      ),
    );

    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner?.status).toBe("fulfilled");
    if (winner?.status !== "fulfilled") {
      throw new Error("expected one successful close");
    }

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(shift.endedAt).not.toBeNull();
    expect(balances).toContain(shift.closingBalance);
    expect(shift.closingBalance).toBe(winner.value.closingBalance);
    expect(shift.closingBalance === 8_111n || shift.closingBalance === 8_999n).toBe(
      true,
    );
  });

  it("writes exactly one success audit under concurrent close contention", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 6_000n,
    });

    await Promise.allSettled([
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 6_001n,
        auditAction: "SHIFT_CLOSE",
      }),
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 6_002n,
        auditAction: "SHIFT_CLOSE",
      }),
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 6_003n,
        auditAction: "SHIFT_CLOSE",
      }),
    ]);

    await expect(
      database.client.auditLog.count({
        where: { action: { in: ["SHIFT_CLOSE", "CLOSE_SHIFT"] } },
      }),
    ).resolves.toBe(1);

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(shift.endedAt).not.toBeNull();
  });

  it("loser does not leave a second audit or alternate balance", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 1_000n,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-c (Cash)",
          amount: 100n,
        },
      ],
    });

    const results = await Promise.allSettled([
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 1_100n,
        notes: "winner-or-loser-a",
        auditAction: "SHIFT_CLOSE",
      }),
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 1_500n,
        notes: "winner-or-loser-b",
        auditAction: "SHIFT_CLOSE",
      }),
    ]);

    const success = results.find((result) => result.status === "fulfilled");
    expect(success?.status).toBe("fulfilled");
    if (success?.status !== "fulfilled") {
      throw new Error("expected one successful close");
    }

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(shift.closingBalance).toBe(success.value.closingBalance);
    expect(shift.expectedBalance).toBe(1_100n);
    expect(shift.discrepancy).toBe(shift.closingBalance - 1_100n);

    const audits = await database.client.auditLog.findMany({
      where: { action: "SHIFT_CLOSE" },
    });
    expect(audits).toHaveLength(1);
    const metadata = JSON.parse(audits[0]!.newValues!);
    expect(metadata.closingBalance).toBe(String(shift.closingBalance));
  });
});
