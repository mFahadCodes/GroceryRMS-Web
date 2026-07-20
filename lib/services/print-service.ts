import { buildReceiptData } from "@/lib/services/order-service";
import { getPublicStoreSettings } from "@/lib/services/settings-service";
import { prisma } from "@/lib/prisma";

async function getReceiptDisplaySettings() {
  const keys = [
    "ShowCustomerOnReceipt",
    "ShowCashierOnReceipt",
    "ShowOrderTypeOnReceipt",
    "ShowTaxBreakdownOnReceipt",
  ];
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys }, isActive: true },
  });
  const byKey = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  return {
    showCustomer: byKey.ShowCustomerOnReceipt !== "false",
    showCashier: byKey.ShowCashierOnReceipt !== "false",
    showOrderType: byKey.ShowOrderTypeOnReceipt !== "false",
    showTaxBreakdown: byKey.ShowTaxBreakdownOnReceipt !== "false",
  };
}

async function getReceiptStoreName(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: "ReceiptStoreName" },
  });
  const value = row?.value?.trim();
  return value ? value : null;
}

export async function buildPrintableReceipt(orderId: number) {
  const [baseReceipt, store, display, receiptStoreName] = await Promise.all([
    buildReceiptData(orderId),
    getPublicStoreSettings(),
    getReceiptDisplaySettings(),
    getReceiptStoreName(),
  ]);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { cashier: { select: { fullName: true } } },
  });

  const receipt = {
    ...baseReceipt,
    ...(display.showCustomer
      ? { customerName: baseReceipt.customer?.name ?? null }
      : {}),
    ...(display.showCashier
      ? { cashierName: order?.cashier?.fullName ?? null }
      : {}),
    ...(display.showOrderType ? { orderType: baseReceipt.orderType } : {}),
    ...(display.showTaxBreakdown
      ? {
          taxBreakdown: {
            taxAmount: baseReceipt.totals.taxAmount,
            discountAmount: baseReceipt.totals.discountAmount,
            subTotal: baseReceipt.totals.subTotal,
          },
        }
      : {}),
    ...("deliveryNote" in baseReceipt
      ? {
          deliveryNote: baseReceipt.deliveryNote ?? null,
          driverName: baseReceipt.driverName ?? null,
          driverPhone: baseReceipt.driverPhone ?? null,
        }
      : {}),
  };

  if (!display.showCustomer) {
    delete (receipt as { customer?: unknown }).customer;
  }

  return {
    store: {
      ...store,
      name: receiptStoreName ?? store.name,
    },
    receipt,
  };
}

export function buildCashDrawerCommand() {
  const bytes = [0x1b, 0x70, 0x00, 0x19, 0xfa] as const;
  return {
    command: "OPEN_CASH_DRAWER",
    escpos: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
    escposBytes: [...bytes],
  };
}
