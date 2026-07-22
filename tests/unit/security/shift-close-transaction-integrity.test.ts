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

describe("shift close transaction integrity", () => {
  const database = createShiftCloseTestDatabase("sec05c-txn-integrity");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetShiftCloseTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("valid close commits endedAt, closingBalance, expectedBalance, and discrepancy", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-1 (Cash)",
          amount: 2_000n,
        },
        { type: "PayIn", description: "float", amount: 500n },
        { type: "PayOut", description: "bank", amount: 200n },
        {
          type: "Refund",
          description: "[CASH] Refund for ORD-1 (Cash)",
          amount: 100n,
        },
      ],
    });

    const closed = await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 12_250n,
      notes: "end of day",
      auditAction: "SHIFT_CLOSE",
      auditIpAddress: "127.0.0.1",
    });

    expect(closed.endedAt).not.toBeNull();
    expect(closed.closingBalance).toBe(12_250n);
    expect(closed.expectedBalance).toBe(12_200n);
    expect(closed.discrepancy).toBe(50n);
    expect(closed.notes).toBe("end of day");

    const persisted = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(persisted.endedAt).toEqual(closed.endedAt);
    expect(persisted.closingBalance).toBe(12_250n);
    expect(persisted.expectedBalance).toBe(12_200n);
    expect(persisted.discrepancy).toBe(50n);
  });

  it("writes exactly one SHIFT_CLOSE success audit with canonical fields", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 5_000n,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 5_000n,
      auditAction: "SHIFT_CLOSE",
      auditIpAddress: "10.0.0.8",
    });

    const audits = await database.client.auditLog.findMany({
      where: { action: "SHIFT_CLOSE" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.userId).toBe(fixture.user.id);
    expect(audits[0]?.recordId).toBe(fixture.shift.id);
    expect(audits[0]?.tableName).toBe("shifts");
    expect(audits[0]?.ipAddress).toBe("10.0.0.8");
  });

  it("writes CLOSE_SHIFT when that audit action is supplied", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 1_000n,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 1_000n,
      auditAction: "CLOSE_SHIFT",
    });

    await expect(
      database.client.auditLog.count({ where: { action: "CLOSE_SHIFT" } }),
    ).resolves.toBe(1);
    await expect(
      database.client.auditLog.count({ where: { action: "SHIFT_CLOSE" } }),
    ).resolves.toBe(0);
  });

  it("records actor and entity correctly on the success audit", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      userId: 11,
      openingBalance: 2_000n,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: 11,
      closingBalance: 2_000n,
      auditAction: "SHIFT_CLOSE",
    });

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SHIFT_CLOSE" },
    });
    expect(audit.userId).toBe(11);
    expect(audit.recordId).toBe(fixture.shift.id);
  });

  it("persists safe metadata without raw notes text", async () => {
    const notes = "closing notes with secret phrase 4826";
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
      terminalId: 1,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-9 (Cash)",
          amount: 500n,
        },
      ],
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 10_400n,
      notes,
      auditAction: "SHIFT_CLOSE",
    });

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "SHIFT_CLOSE" },
    });
    expect(audit.newValues).toBeTruthy();
    const metadata = JSON.parse(audit.newValues!);
    expect(metadata).toMatchObject({
      reasonProvided: true,
      reasonLength: notes.length,
      closingBalance: "10400",
      expectedBalance: "10500",
      discrepancy: "-100",
      terminalId: 1,
    });
    expect(audit.newValues).not.toContain("4826");
    expect(audit.newValues).not.toContain("secret phrase");
    expect(audit.newValues).not.toContain(notes);
    expect(metadata).not.toHaveProperty("notes");
  });

  it("zero discrepancy close still writes safe balance metadata", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 3_000n,
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 3_000n,
      auditAction: "CLOSE_SHIFT",
    });

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { action: "CLOSE_SHIFT" },
    });
    const metadata = JSON.parse(audit.newValues!);
    expect(metadata.closingBalance).toBe("3000");
    expect(metadata.expectedBalance).toBe("3000");
    expect(metadata.discrepancy).toBe("0");
    expect(metadata.reasonProvided).toBe(false);
  });
});
