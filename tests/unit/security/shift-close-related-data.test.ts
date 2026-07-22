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
  seedActiveOrderOnShift,
  seedClosedOrderOnShift,
  seedShiftCloseFixture,
} from "./shift-close-test-database";

describe("shift close related data", () => {
  const database = createShiftCloseTestDatabase("sec05c-related-data");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetShiftCloseTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("does not mutate orders or payments when closing a shift", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 10_000n,
    });
    const { order, payment } = await seedClosedOrderOnShift(database.client, {
      shiftId: fixture.shift.id,
      cashierId: fixture.user.id,
      terminalId: fixture.terminalId,
      withPayment: true,
    });

    const orderBefore = await database.client.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const paymentBefore = await database.client.payment.findUniqueOrThrow({
      where: { id: payment!.id },
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 10_000n,
      auditAction: "SHIFT_CLOSE",
    });

    const orderAfter = await database.client.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const paymentAfter = await database.client.payment.findUniqueOrThrow({
      where: { id: payment!.id },
    });

    expect(orderAfter.status).toBe(orderBefore.status);
    expect(orderAfter.grandTotal).toBe(orderBefore.grandTotal);
    expect(orderAfter.shiftId).toBe(orderBefore.shiftId);
    expect(orderAfter.updatedAt).toEqual(orderBefore.updatedAt);
    expect(paymentAfter.amount).toBe(paymentBefore.amount);
    expect(paymentAfter.status).toBe(paymentBefore.status);
    expect(paymentAfter.updatedAt).toEqual(paymentBefore.updatedAt);
  });

  it("does not mutate other open shifts or users", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 3_000n,
      seedOtherOpenShift: true,
      otherOpeningBalance: 9_000n,
    });

    const otherBefore = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.otherShift!.id },
    });
    const userBefore = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.user.id },
    });
    const otherUserBefore = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.otherUser.id },
    });

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 3_000n,
      auditAction: "CLOSE_SHIFT",
    });

    const otherAfter = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.otherShift!.id },
    });
    expect(otherAfter.endedAt).toBeNull();
    expect(otherAfter.openingBalance).toBe(9_000n);
    expect(otherAfter.closingBalance).toBe(0n);
    expect(otherAfter.updatedAt).toEqual(otherBefore.updatedAt);

    const userAfter = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.user.id },
    });
    const otherUserAfter = await database.client.user.findUniqueOrThrow({
      where: { id: fixture.otherUser.id },
    });
    expect(userAfter.username).toBe(userBefore.username);
    expect(userAfter.updatedAt).toEqual(userBefore.updatedAt);
    expect(otherUserAfter.username).toBe(otherUserBefore.username);
    expect(otherUserAfter.updatedAt).toEqual(otherUserBefore.updatedAt);
  });

  it("does not change cash drawer log count on close", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 5_000n,
      cashDrawerLogs: [
        {
          type: "Sale",
          description: "[CASH] ORD-1 (Cash)",
          amount: 100n,
        },
        { type: "PayIn", description: "float", amount: 50n },
        { type: "PayOut", description: "bank", amount: 25n },
        {
          type: "Refund",
          description: "[CASH] Refund for ORD-1 (Cash)",
          amount: 10n,
        },
      ],
    });

    const beforeCount = await database.client.cashDrawerLog.count({
      where: { shiftId: fixture.shift.id },
    });
    expect(beforeCount).toBe(4);

    await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 5_115n,
      auditAction: "SHIFT_CLOSE",
    });

    await expect(
      database.client.cashDrawerLog.count({
        where: { shiftId: fixture.shift.id },
      }),
    ).resolves.toBe(4);
  });

  it("fails ownership mismatch without writing an audit", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 2_000n,
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.otherUser.id,
        closingBalance: 2_000n,
        auditAction: "SHIFT_CLOSE",
      }),
    ).rejects.toThrow(/not found/i);

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(shift.endedAt).toBeNull();
    await expect(database.client.auditLog.count()).resolves.toBe(0);
  });

  it("fails missing shift without writing an audit", async () => {
    await seedShiftCloseFixture(database.client, {
      openingBalance: 1_000n,
    });

    await expect(
      closeShift({
        shiftId: 999_999,
        userId: 2,
        closingBalance: 1_000n,
        auditAction: "CLOSE_SHIFT",
      }),
    ).rejects.toThrow(/not found/i);

    await expect(database.client.auditLog.count()).resolves.toBe(0);
  });

  it("fails with active orders without writing an audit", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 4_000n,
    });
    await seedActiveOrderOnShift(database.client, {
      shiftId: fixture.shift.id,
      cashierId: fixture.user.id,
      terminalId: fixture.terminalId,
      status: "Open",
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 4_000n,
        auditAction: "SHIFT_CLOSE",
      }),
    ).rejects.toThrow(/active or unpaid orders/i);

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: fixture.shift.id },
    });
    expect(shift.endedAt).toBeNull();
    await expect(database.client.auditLog.count()).resolves.toBe(0);
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
  ] as const)("blocks close when an active %s order exists", async (status) => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 1_500n,
    });
    await seedActiveOrderOnShift(database.client, {
      shiftId: fixture.shift.id,
      cashierId: fixture.user.id,
      terminalId: fixture.terminalId,
      orderId: 70 + status.length,
      status,
    });

    await expect(
      closeShift({
        shiftId: fixture.shift.id,
        userId: fixture.user.id,
        closingBalance: 1_500n,
        auditAction: "CLOSE_SHIFT",
      }),
    ).rejects.toThrow(/active or unpaid orders/i);

    await expect(database.client.auditLog.count()).resolves.toBe(0);
  });

  it("allows close when only closed orders remain on the shift", async () => {
    const fixture = await seedShiftCloseFixture(database.client, {
      openingBalance: 2_200n,
    });
    await seedClosedOrderOnShift(database.client, {
      shiftId: fixture.shift.id,
      cashierId: fixture.user.id,
      terminalId: fixture.terminalId,
    });

    const closed = await closeShift({
      shiftId: fixture.shift.id,
      userId: fixture.user.id,
      closingBalance: 2_200n,
      auditAction: "SHIFT_CLOSE",
    });

    expect(closed.endedAt).not.toBeNull();
    await expect(
      database.client.auditLog.count({ where: { action: "SHIFT_CLOSE" } }),
    ).resolves.toBe(1);
  });
});
