import {
  isCashDrawerRefundLog,
  isCashDrawerSaleLog,
} from "@/lib/cash-drawer";
import { prisma } from "@/lib/prisma";

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

export async function closeShift(input: {
  shiftId: number;
  userId: number;
  closingBalance: bigint;
  notes?: string | null;
}) {
  const shift = await prisma.shift.findUnique({
    where: { id: input.shiftId },
    include: { cashDrawerLogs: true },
  });
  if (!shift || shift.userId !== input.userId) {
    throw new Error("Shift not found");
  }
  if (shift.endedAt) {
    throw new Error("Shift is already closed");
  }

  const activeOrderCount = await prisma.order.count({
    where: {
      shiftId: input.shiftId,
      isActive: true,
      status: { in: ["Open", "PartiallyPaid", "Packed", "OutForDelivery"] },
    },
  });
  if (activeOrderCount > 0) {
    throw new Error("Cannot close shift with active or unpaid orders.");
  }

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
  const discrepancy = input.closingBalance - expectedBalance;

  return prisma.shift.update({
    where: { id: input.shiftId },
    data: {
      endedAt: new Date(),
      closingBalance: input.closingBalance,
      expectedBalance,
      discrepancy,
      notes: input.notes ?? shift.notes,
    },
    include: { terminal: true, cashDrawerLogs: true },
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
