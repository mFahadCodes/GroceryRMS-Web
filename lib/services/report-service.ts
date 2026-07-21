import {
  isDateOnlyString,
  localDayRangeFromString,
  localDayRangeFromTo,
  toLocalDateString,
} from "@/lib/date-range";
import { mapAuditLogForResponse } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { formatPKR } from "@/lib/currency";
import { getLowStockProducts } from "@/lib/services/inventory-service";

function dayRange(date: Date | string) {
  if (typeof date === "string" && isDateOnlyString(date)) {
    return localDayRangeFromString(date);
  }
  const asDate = typeof date === "string" ? new Date(date) : date;
  return localDayRangeFromString(toLocalDateString(asDate));
}

function dayStart(input: Date | string): Date {
  return dayRange(input).start;
}

function dayEndExclusive(input: Date | string): Date {
  return dayRange(input).end;
}

export async function generateDailySummary(
  date: Date | string,
  terminalId?: number,
) {
  const { start, end } = dayRange(date);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      ...(terminalId ? { terminalId } : {}),
    },
    include: { payments: { include: { paymentMethod: true } } },
  });

  const closed = orders.filter((o) => o.status === "Closed");
  const voided = orders.filter((o) => o.status === "Void");

  const allPayments = closed.flatMap((o) => o.payments);
  const cashSales = allPayments
    .filter((p) => p.paymentMethod.code?.toUpperCase() === "CASH")
    .reduce((s, p) => s + p.amount, 0n);
  const cardSales = allPayments
    .filter((p) =>
      ["CARD", "DEBIT", "CREDIT"].includes(
        p.paymentMethod.code?.toUpperCase() ?? "",
      ),
    )
    .reduce((s, p) => s + p.amount, 0n);
  const digitalSales = allPayments
    .filter((p) => p.paymentMethod.isDigital)
    .reduce((s, p) => s + p.amount, 0n);

  const hourCounts = new Map<number, number>();
  for (const order of closed) {
    const hour = order.createdAt.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  let peakHour = 0;
  let peakCount = 0;
  hourCounts.forEach((count, hour) => {
    if (count > peakCount) {
      peakCount = count;
      peakHour = hour;
    }
  });

  const summaryData = {
    date: start,
    totalOrders: closed.length,
    totalRevenue: closed.reduce((s, o) => s + o.grandTotal, 0n),
    totalTax: closed.reduce((s, o) => s + o.taxAmount, 0n),
    totalDiscount: closed.reduce((s, o) => s + o.discountAmount, 0n),
    cashSales,
    cardSales,
    digitalSales,
    voidedOrders: voided.length,
    peakHour,
    terminalId: terminalId ?? null,
  };

  const existing = await prisma.dailySummary.findFirst({
    where: { date: start, terminalId: terminalId ?? null },
  });

  if (existing) {
    return prisma.dailySummary.update({
      where: { id: existing.id },
      data: summaryData,
    });
  }

  return prisma.dailySummary.create({ data: summaryData });
}

export async function getDailySummary(
  date: Date | string,
  terminalId?: number,
) {
  const { start } = dayRange(date);
  const isToday =
    start.toDateString() === toLocalDateString(new Date());

  if (isToday) {
    await generateDailySummary(date, terminalId);
  }

  let summary = await prisma.dailySummary.findFirst({
    where: { date: start, terminalId: terminalId ?? null },
  });

  if (!summary) {
    summary = await generateDailySummary(date, terminalId);
  }

  const avgOrderValue =
    summary.totalOrders > 0
      ? summary.totalRevenue / BigInt(summary.totalOrders)
      : 0n;

  return {
    ...summary,
    avgOrderValue,
    avgOrderValueFormatted: formatPKR(avgOrderValue),
  };
}

export async function getSalesByCategory(
  from: Date | string,
  to: Date | string,
) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);

  const items = await prisma.orderItem.findMany({
    where: {
      status: { not: "Void" },
      order: {
        status: "Closed",
        createdAt: { gte: fromStart, lt: toEnd },
      },
    },
    include: { product: { include: { category: true } } },
  });

  const totals = new Map<string, bigint>();
  for (const item of items) {
    const name = item.product.category.name;
    totals.set(name, (totals.get(name) ?? 0n) + item.lineTotal);
  }

  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => (a.total > b.total ? -1 : 1));
}

export async function getSalesByHour(date: Date | string) {
  const { start, end } = dayRange(date);

  const orders = await prisma.order.findMany({
    where: {
      status: "Closed",
      createdAt: { gte: start, lt: end },
    },
  });

  const totals = new Map<number, bigint>();
  for (const order of orders) {
    const hour = order.createdAt.getHours();
    totals.set(hour, (totals.get(hour) ?? 0n) + order.grandTotal);
  }

  return Array.from(totals.entries())
    .map(([hour, total]) => ({ hour, total }))
    .sort((a, b) => a.hour - b.hour);
}

export async function getPeakHour(date: Date | string) {
  const hourly = await getSalesByHour(date);
  if (hourly.length === 0) return { hour: 0, total: 0n };
  return hourly.reduce((peak, row) =>
    row.total > peak.total ? row : peak,
  );
}

export async function getSalesByPayment(from: Date | string, to: Date | string) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);
  const rows = await prisma.payment.findMany({
    where: {
      order: { status: "Closed", createdAt: { gte: fromStart, lt: toEnd } },
      status: "Paid",
    },
    include: { paymentMethod: true },
  });
  const bucket = new Map<string, bigint>();
  for (const row of rows) {
    const key = row.paymentMethod.name;
    bucket.set(key, (bucket.get(key) ?? 0n) + row.amount);
  }
  return Array.from(bucket.entries()).map(([method, total]) => ({ method, total }));
}

export async function getProductPerformance(from: Date | string, to: Date | string) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);
  const rows = await prisma.orderItem.findMany({
    where: {
      order: { status: "Closed", createdAt: { gte: fromStart, lt: toEnd } },
      status: { not: "Void" },
    },
    include: { product: true },
  });
  const bucket = new Map<number, { name: string; qty: number; sales: bigint; cogs: bigint }>();
  for (const row of rows) {
    const existing = bucket.get(row.productId) ?? {
      name: row.product.name,
      qty: 0,
      sales: 0n,
      cogs: 0n,
    };
    existing.qty += row.quantity;
    existing.sales += row.lineTotal;
    existing.cogs += row.product.costPrice * BigInt(row.quantity);
    bucket.set(row.productId, existing);
  }
  return Array.from(bucket.values()).map((row) => ({
    ...row,
    grossProfit: row.sales - row.cogs,
  }));
}

export async function getCashierPerformance(from: Date | string, to: Date | string) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);
  const rows = await prisma.order.findMany({
    where: { status: "Closed", createdAt: { gte: fromStart, lt: toEnd } },
    include: { cashier: true },
  });
  const bucket = new Map<number, { cashierId: number; cashierName: string; orders: number; sales: bigint }>();
  for (const row of rows) {
    if (!row.cashierId) continue;
    const existing = bucket.get(row.cashierId) ?? {
      cashierId: row.cashierId,
      cashierName: row.cashier?.fullName ?? row.cashier?.username ?? "Unknown",
      orders: 0,
      sales: 0n,
    };
    existing.orders += 1;
    existing.sales += row.grandTotal;
    bucket.set(row.cashierId, existing);
  }
  return Array.from(bucket.values());
}

export async function getExpenseReport(from: Date | string, to: Date | string) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);
  return prisma.supplierExpense.findMany({
    where: { expenseDate: { gte: fromStart, lt: toEnd }, isActive: true },
    include: { supplier: true },
    orderBy: { expenseDate: "desc" },
  });
}

export async function getProfitLoss(from: Date | string, to: Date | string) {
  const [sales, expenses, performance] = await Promise.all([
    prisma.order.aggregate({
      where: { status: "Closed", createdAt: { gte: dayStart(from), lt: dayEndExclusive(to) } },
      _sum: { grandTotal: true },
    }),
    prisma.supplierExpense.aggregate({
      where: { isActive: true, expenseDate: { gte: dayStart(from), lt: dayEndExclusive(to) } },
      _sum: { amount: true },
    }),
    getProductPerformance(from, to),
  ]);
  const cogs = performance.reduce((sum, row) => sum + row.cogs, 0n);
  const revenue = sales._sum.grandTotal ?? 0n;
  const totalExpenses = expenses._sum.amount ?? 0n;
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - totalExpenses;
  return { revenue, cogs, grossProfit, totalExpenses, netProfit };
}

export async function getLowStockReport() {
  const rows = await getLowStockProducts();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currentStock: row.currentStock,
    reorderLevel: row.reorderLevel,
  }));
}

export async function getDriverPerformance(
  from: Date | string,
  to: Date | string,
) {
  const fromStart = dayStart(from);
  const toEnd = dayEndExclusive(to);

  const delivered = await prisma.order.findMany({
    where: {
      orderType: "Delivery",
      status: "Delivered",
      createdAt: { gte: fromStart, lt: toEnd },
      driverId: { not: null },
    },
    include: { driver: true },
  });

  const stillOpen = await prisma.order.findMany({
    where: {
      orderType: "Delivery",
      status: "OutForDelivery",
      createdAt: { gte: fromStart, lt: toEnd },
      driverId: { not: null },
    },
    select: { driverId: true },
  });

  const byDriver = new Map<
    number,
    {
      driverName: string;
      totalDeliveries: number;
      totalRevenue: bigint;
      deliveryMinutes: number[];
      openCount: number;
    }
  >();

  for (const order of delivered) {
    if (!order.driverId || !order.driver) continue;
    const row = byDriver.get(order.driverId) ?? {
      driverName: order.driver.name,
      totalDeliveries: 0,
      totalRevenue: 0n,
      deliveryMinutes: [],
      openCount: 0,
    };
    row.totalDeliveries += 1;
    row.totalRevenue += order.grandTotal;
    if (order.deliveredAt) {
      const minutes =
        (order.deliveredAt.getTime() - order.createdAt.getTime()) / 60000;
      row.deliveryMinutes.push(minutes);
    }
    byDriver.set(order.driverId, row);
  }

  for (const order of stillOpen) {
    if (!order.driverId) continue;
    const existing = byDriver.get(order.driverId);
    if (existing) {
      existing.openCount += 1;
    } else {
      const driver = await prisma.employee.findUnique({
        where: { id: order.driverId },
      });
      byDriver.set(order.driverId, {
        driverName: driver?.name ?? "Unknown",
        totalDeliveries: 0,
        totalRevenue: 0n,
        deliveryMinutes: [],
        openCount: 1,
      });
    }
  }

  return Array.from(byDriver.values()).map((row) => {
    const avgDeliveryTimeMinutes =
      row.deliveryMinutes.length > 0
        ? row.deliveryMinutes.reduce((s, m) => s + m, 0) /
          row.deliveryMinutes.length
        : 0;
    const denominator = row.totalDeliveries + row.openCount;
    const completionRate =
      denominator > 0 ? (row.totalDeliveries / denominator) * 100 : 0;
    return {
      driverName: row.driverName,
      totalDeliveries: row.totalDeliveries,
      totalRevenue: row.totalRevenue,
      avgDeliveryTimeMinutes: Math.round(avgDeliveryTimeMinutes * 100) / 100,
      completionRate: Math.round(completionRate * 100) / 100,
    };
  });
}

export async function getExpiryReport(daysAhead = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);
  const now = new Date();

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      expiryDate: { not: null, lte: cutoff },
    },
    include: {
      category: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { expiryDate: "asc" },
  });

  return products.map((product) => {
    const expiry = product.expiryDate!;
    const daysUntilExpiry = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      id: product.id,
      name: product.name,
      barcode: product.barcode,
      currentStock: product.currentStock,
      expiryDate: expiry,
      daysUntilExpiry,
      category: product.category ? { name: product.category.name } : null,
      supplier: product.supplier ? { name: product.supplier.name } : null,
    };
  });
}

export async function getSalesReport(
  from: string,
  to: string,
  mode: "all" | "bill",
) {
  const { start, end } =
    from === to ? dayRange(from) : localDayRangeFromTo(from, to);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: "Closed",
      isActive: true,
    },
    include: {
      orderItems: {
        where: { status: { not: "Void" } },
        include: { product: { select: { name: true } } },
      },
      payments: { include: { paymentMethod: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const cashInHand = orders
    .flatMap((order) => order.payments)
    .filter((payment) => payment.paymentMethod.code?.toUpperCase() === "CASH")
    .reduce((sum, payment) => sum + payment.amount, 0n);

  if (mode === "bill") {
    return {
      from,
      to,
      mode,
      cashInHand,
      cashInHandFormatted: formatPKR(cashInHand),
      rows: orders.map((order) => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        itemCount: order.orderItems.length,
        qtySum: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        grandTotal: order.grandTotal,
        grandTotalFormatted: formatPKR(order.grandTotal),
        createdAt: order.createdAt,
      })),
    };
  }

  const rows = orders.flatMap((order) =>
    order.orderItems.map((item) => ({
      orderNumber: order.orderNumber,
      productName: item.product.name,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      lineTotalFormatted: formatPKR(item.lineTotal),
    })),
  );

  return {
    from,
    to,
    mode,
    cashInHand,
    cashInHandFormatted: formatPKR(cashInHand),
    rows,
  };
}

export async function getAuditLogReport(page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    }),
    prisma.auditLog.count(),
  ]);
  return {
    items: items.map((item) => mapAuditLogForResponse(item)),
    total,
    page,
    limit,
  };
}
