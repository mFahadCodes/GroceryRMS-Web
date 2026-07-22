import type { CashDrawerLogType, PrismaClient } from "@prisma/client";
import {
  createManagerApprovalTestDatabase,
  managerApprovalMigrationPaths,
} from "./manager-approval-test-database";

export {
  createManagerApprovalTestDatabase as createShiftCloseTestDatabase,
  managerApprovalMigrationPaths,
};

export type ShiftCloseCashDrawerSeed = {
  type: CashDrawerLogType;
  amount: bigint;
  description?: string | null;
  orderId?: number | null;
};

export async function resetShiftCloseTables(client: PrismaClient) {
  await client.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_audit_insert");
  await client.cashDrawerLog.deleteMany();
  await client.payment.deleteMany();
  await client.auditLog.deleteMany();
  await client.orderItem.deleteMany();
  await client.order.deleteMany();
  await client.shift.deleteMany();
  await client.userSession.deleteMany();
  await client.user.deleteMany();
  await client.rolePermission.deleteMany();
  await client.permission.deleteMany();
  await client.role.deleteMany();
  await client.paymentMethod.deleteMany();
  await client.terminal.deleteMany();
  await client.pinThrottleState.deleteMany();
}

export async function seedShiftCloseFixture(
  client: PrismaClient,
  options: {
    userId?: number;
    otherUserId?: number;
    terminalId?: number | null;
    openingBalance?: bigint;
    notes?: string | null;
    cashDrawerLogs?: ShiftCloseCashDrawerSeed[];
    seedOtherOpenShift?: boolean;
    otherOpeningBalance?: bigint;
  } = {},
) {
  const userId = options.userId ?? 2;
  const otherUserId = options.otherUserId ?? 7;
  const terminalId = options.terminalId === undefined ? 1 : options.terminalId;
  const openingBalance = options.openingBalance ?? 10_000n;
  const notes = options.notes ?? null;

  if (terminalId !== null) {
    await client.terminal.create({
      data: { id: terminalId, name: `Terminal ${terminalId}` },
    });
  }

  await client.role.create({ data: { id: 1, name: "Cashier" } });
  await client.role.create({ data: { id: 2, name: "Manager" } });

  const user = await client.user.create({
    data: {
      id: userId,
      username: "cashier",
      fullName: "Cashier",
      passwordHash: "test-only-password-hash",
      roleId: 1,
    },
  });

  const otherUser = await client.user.create({
    data: {
      id: otherUserId,
      username: "other-cashier",
      fullName: "Other Cashier",
      passwordHash: "test-only-password-hash",
      roleId: 2,
    },
  });

  await client.paymentMethod.create({
    data: { id: 1, name: "Cash", code: "CASH" },
  });

  const shift = await client.shift.create({
    data: {
      userId: user.id,
      terminalId,
      openingBalance,
      notes,
    },
  });

  const cashDrawerLogs = [];
  for (const log of options.cashDrawerLogs ?? []) {
    cashDrawerLogs.push(
      await client.cashDrawerLog.create({
        data: {
          shiftId: shift.id,
          type: log.type,
          amount: log.amount,
          description: log.description ?? null,
          orderId: log.orderId ?? null,
          userId: user.id,
        },
      }),
    );
  }

  let otherShift = null;
  if (options.seedOtherOpenShift) {
    otherShift = await client.shift.create({
      data: {
        userId: otherUser.id,
        terminalId,
        openingBalance: options.otherOpeningBalance ?? 5_000n,
      },
    });
  }

  return {
    user,
    otherUser,
    shift,
    otherShift,
    cashDrawerLogs,
    terminalId,
    openingBalance,
  };
}

export async function seedClosedOrderOnShift(
  client: PrismaClient,
  input: {
    shiftId: number;
    cashierId: number;
    terminalId?: number | null;
    orderId?: number;
    grandTotal?: bigint;
    withPayment?: boolean;
  },
) {
  const orderId = input.orderId ?? 50;
  const grandTotal = input.grandTotal ?? 2_500n;
  const order = await client.order.create({
    data: {
      id: orderId,
      orderNumber: `ORD-${orderId}`,
      orderType: "WalkIn",
      status: "Closed",
      cashierId: input.cashierId,
      terminalId: input.terminalId ?? null,
      shiftId: input.shiftId,
      subTotal: grandTotal,
      grandTotal,
      isActive: true,
    },
  });

  let payment = null;
  if (input.withPayment !== false) {
    payment = await client.payment.create({
      data: {
        orderId: order.id,
        paymentMethodId: 1,
        amount: grandTotal,
        tenderedAmount: grandTotal,
        changeAmount: 0n,
        status: "Paid",
      },
    });
  }

  return { order, payment };
}

export async function seedActiveOrderOnShift(
  client: PrismaClient,
  input: {
    shiftId: number;
    cashierId: number;
    terminalId?: number | null;
    orderId?: number;
    status?: "Open" | "PartiallyPaid" | "Packed" | "OutForDelivery";
  },
) {
  const orderId = input.orderId ?? 60;
  return client.order.create({
    data: {
      id: orderId,
      orderNumber: `ORD-${orderId}`,
      orderType: "WalkIn",
      status: input.status ?? "Open",
      cashierId: input.cashierId,
      terminalId: input.terminalId ?? null,
      shiftId: input.shiftId,
      subTotal: 1_000n,
      grandTotal: 1_000n,
      isActive: true,
    },
  });
}
