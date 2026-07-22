import type { CashDrawerLog } from "@prisma/client";
import {
  isCashDrawerRefundLog,
  isCashDrawerSaleLog,
} from "@/lib/cash-drawer";
import { writeRequiredAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { buildShiftCloseAuditMetadata } from "@/lib/security/audit-metadata";

export async function getOpenShift(userId: number, terminalId?: number) {
  return prisma.shift.findFirst({
    where: {
      userId,
      endedAt: null,
      isActive: true,
      ...(terminalId ? { terminalId } : {}),
    },
    include: {
      terminal: true,
      cashDrawerLogs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

export async function openShift(input: {
  userId: number;
  terminalId?: number | null;
  openingBalance: bigint;
  notes?: string | null;
}) {
  const existing = await getOpenShift(input.userId, input.terminalId ?? undefined);
  if (existing) {
    throw new Error("Shift is already open");
  }

  return prisma.shift.create({
    data: {
      userId: input.userId,
      terminalId: input.terminalId ?? null,
      openingBalance: input.openingBalance,
      notes: input.notes ?? null,
    },
    include: { terminal: true },
  });
}

/**
 * Pure shift-close cash formula. Preserves the historical close math exactly:
 * expected = opening + cashSales + payIns - payOuts - cashRefunds
 * discrepancy = closingBalance - expected
 */
export function calculateShiftCloseTotals(
  openingBalance: bigint,
  cashDrawerLogs: Array<Pick<CashDrawerLog, "type" | "description" | "amount">>,
  closingBalance: bigint,
) {
  const cashSales = cashDrawerLogs
    .filter((log) => isCashDrawerSaleLog(log))
    .reduce((sum, log) => sum + log.amount, 0n);
  const payIns = cashDrawerLogs
    .filter((log) => log.type === "PayIn")
    .reduce((sum, log) => sum + log.amount, 0n);
  const payOuts = cashDrawerLogs
    .filter((log) => log.type === "PayOut")
    .reduce((sum, log) => sum + log.amount, 0n);
  const cashRefunds = cashDrawerLogs
    .filter((log) => isCashDrawerRefundLog(log))
    .reduce((sum, log) => sum + log.amount, 0n);

  const expectedBalance =
    openingBalance + cashSales + payIns - payOuts - cashRefunds;
  const discrepancy = closingBalance - expectedBalance;

  return {
    cashSales,
    payIns,
    payOuts,
    cashRefunds,
    expectedBalance,
    discrepancy,
  };
}

export type ShiftCloseAuditAction = "CLOSE_SHIFT" | "SHIFT_CLOSE";

/**
 * SEC-05C: close mutation and required audit share one Prisma transaction.
 * Concurrent closes use a conditional update (`endedAt: null`) so at most one
 * request succeeds; the loser sees already-closed and writes no success audit.
 */
export async function closeShift(input: {
  shiftId: number;
  userId: number;
  closingBalance: bigint;
  notes?: string | null;
  auditAction: ShiftCloseAuditAction;
  auditIpAddress?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findUnique({
      where: { id: input.shiftId },
      include: { cashDrawerLogs: true },
    });
    if (!shift || shift.userId !== input.userId) {
      throw new Error("Shift not found");
    }
    if (shift.endedAt) {
      throw new Error("Shift is already closed");
    }

    const activeOrderCount = await tx.order.count({
      where: {
        shiftId: input.shiftId,
        isActive: true,
        status: { in: ["Open", "PartiallyPaid", "Packed", "OutForDelivery"] },
      },
    });
    if (activeOrderCount > 0) {
      throw new Error("Cannot close shift with active or unpaid orders.");
    }

    const totals = calculateShiftCloseTotals(
      shift.openingBalance,
      shift.cashDrawerLogs,
      input.closingBalance,
    );
    const closedAt = new Date();
    const notes = input.notes ?? shift.notes;

    // Conditional state transition: only an open shift owned by the actor
    // may close. Exactly one row must change under concurrent contenders.
    const updated = await tx.shift.updateMany({
      where: {
        id: input.shiftId,
        userId: input.userId,
        endedAt: null,
      },
      data: {
        endedAt: closedAt,
        closingBalance: input.closingBalance,
        expectedBalance: totals.expectedBalance,
        discrepancy: totals.discrepancy,
        notes,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Shift is already closed");
    }

    await writeRequiredAudit(tx, {
      userId: input.userId,
      action: input.auditAction,
      recordId: input.shiftId,
      newValues: buildShiftCloseAuditMetadata({
        closingBalance: input.closingBalance,
        expectedBalance: totals.expectedBalance,
        discrepancy: totals.discrepancy,
        terminalId: shift.terminalId,
        notes,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    return tx.shift.findUniqueOrThrow({
      where: { id: input.shiftId },
      include: { terminal: true, cashDrawerLogs: true },
    });
  });
}

export async function getShiftById(shiftId: number) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      terminal: true,
      user: true,
      cashDrawerLogs: { orderBy: { createdAt: "desc" } },
      orders: true,
    },
  });
  if (!shift) return null;

  const cashSales = shift.cashDrawerLogs
    .filter((log) => isCashDrawerSaleLog(log))
    .reduce((sum, log) => sum + log.amount, 0n);
  const payIns = shift.cashDrawerLogs
    .filter((log) => log.type === "PayIn")
    .reduce((sum, log) => sum + log.amount, 0n);
  const payOuts = shift.cashDrawerLogs
    .filter((log) => log.type === "PayOut")
    .reduce((sum, log) => sum + log.amount, 0n);
  const cashRefunds = shift.cashDrawerLogs
    .filter((log) => isCashDrawerRefundLog(log))
    .reduce((sum, log) => sum + log.amount, 0n);

  const expectedBalance =
    shift.openingBalance + cashSales + payIns - payOuts - cashRefunds;

  return { ...shift, expectedBalanceCalculated: expectedBalance };
}

export async function listShifts(params: {
  page: number;
  pageSize: number;
  userId?: number;
}) {
  const where = {
    isActive: true,
    ...(params.userId ? { userId: params.userId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        terminal: true,
        _count: { select: { orders: true } },
      },
    }),
    prisma.shift.count({ where }),
  ]);

  return {
    items: rows.map((shift) => ({
      id: shift.id,
      userId: shift.userId,
      userName: shift.user.fullName,
      terminalId: shift.terminalId,
      terminalName: shift.terminal?.name ?? null,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      openingBalance: shift.openingBalance,
      closingBalance: shift.closingBalance,
      expectedBalance: shift.expectedBalance,
      discrepancy: shift.discrepancy,
      orderCount: shift._count.orders,
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function listCashDrawerLogs(input: {
  shiftId: number;
  type?: "PayIn" | "PayOut";
  page: number;
  pageSize: number;
}) {
  const where = {
    shiftId: input.shiftId,
    isActive: true,
    ...(input.type ? { type: input.type } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.cashDrawerLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        user: { select: { id: true, username: true, fullName: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    prisma.cashDrawerLog.count({ where }),
  ]);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function addCashDrawerEntry(input: {
  shiftId: number;
  type: "PayIn" | "PayOut";
  amount: bigint;
  description?: string | null;
  orderId?: number | null;
  userId?: number | null;
}) {
  return prisma.cashDrawerLog.create({
    data: {
      shiftId: input.shiftId,
      type: input.type,
      amount: input.amount,
      description: input.description ?? null,
      orderId: input.orderId ?? null,
      userId: input.userId ?? null,
    },
  });
}
