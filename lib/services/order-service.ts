import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CustomerTier, OrderStatus, OrderType } from "@prisma/client";
import { writeRequiredAudit } from "@/lib/audit";
import { ServiceError } from "@/lib/api/service-error";
import { createOrderWithUniqueNumber } from "@/lib/order-number";
import { calculatePaisaTotals } from "@/lib/paisa-math";
import {
  buildOrderCheckoutAuditMetadata,
  buildOrderDiscountAuditMetadata,
  buildOrderPartialPaymentAuditMetadata,
  buildOrderRefundAuditMetadata,
  buildOrderReturnAuditMetadata,
  buildOrderVoidAuditMetadata,
} from "@/lib/security/audit-metadata";
import {
  acquirePayableOrderWrite,
  assertPaymentWithinRemaining,
  claimCheckoutCompletion,
  claimOrderClosedFromPayable,
  claimOrderPartiallyPaid,
  remainingBalance,
  sumPaymentAmounts,
} from "@/lib/security/order-financial-concurrency";
import {
  acquireClosedOrderWrite,
  assertNoLegacyNullLineageReturns,
  assertRefundWithinRemaining,
  claimSourceReturnQuantities,
  remainingRefundableAmount,
  sumCommittedRefundAbsolute,
} from "@/lib/security/refund-return-concurrency";
import {
  assertOrderVoidable,
  claimVoidTransition,
} from "@/lib/security/void-concurrency";
import {
  assertOrderDiscountable,
  claimDiscountMutation,
} from "@/lib/security/discount-concurrency";
import {
  consumeManagerApprovalGrant,
  type ManagerApprovalRequester,
} from "@/lib/services/manager-approval-service";
import { PERMS } from "@/lib/api/permissions";
import {
  createSaleDrawerLog,
  refundDrawerDescription,
} from "@/lib/cash-drawer";
import { formatPKR } from "@/lib/currency";
import { localDayRangeFromString, toLocalDateString } from "@/lib/date-range";

export async function createOrder(input: {
  orderType: OrderType;
  customerId?: number | null;
  cashierId: number;
  terminalId?: number | null;
  shiftId?: number | null;
  notes?: string | null;
}) {
  return createOrderWithUniqueNumber((orderNumber) =>
    prisma.order.create({
      data: {
        orderNumber,
        orderType: input.orderType,
        status: "Open",
        customerId: input.customerId ?? null,
        cashierId: input.cashierId,
        terminalId: input.terminalId ?? null,
        shiftId: input.shiftId ?? null,
        notes: input.notes ?? null,
      },
      include: orderInclude,
    }),
  );
}

export const orderInclude = {
  orderItems: {
    where: { status: { not: "Void" as const } },
    include: { product: true, variant: true },
  },
  payments: { include: { paymentMethod: true } },
  customer: true,
  cashier: { select: { id: true, username: true, fullName: true } },
  shift: true,
  terminal: true,
};

export async function getOrderById(orderId: number) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...orderInclude,
      orderItems: {
        include: { product: true, variant: true },
      },
      loyaltyTransactions: true,
      driver: { select: { id: true, name: true, phone: true } },
    },
  });
}

export async function calculateTotals(
  orderId: number,
  discountPercent = 0,
  taxPercent?: number,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: { where: { status: { not: "Void" } } },
    },
  });
  if (!order) throw new ServiceError("Order not found");

  const subTotal = order.orderItems.reduce(
    (sum, item) => sum + item.lineTotal,
    0n,
  );

  let discountAmount = order.discountAmount;
  if (discountPercent > 0) {
    discountAmount =
      (subTotal * BigInt(Math.round(discountPercent * 100))) / 10000n;
  }

  const tax =
    taxPercent !== undefined
      ? { taxPercent, isInclusive: false }
      : await resolveTaxRate(order.taxRateId);

  const totals = calculatePaisaTotals({
    subTotal,
    discountAmount,
    taxPercent: tax.taxPercent,
    isInclusive: tax.isInclusive,
    serviceChargeAmount: order.serviceCharge,
    adjustment: order.adjustment,
  });

  return prisma.order.update({
    where: { id: orderId },
    data: {
      subTotal: totals.subTotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      serviceCharge: totals.serviceCharge,
      grandTotal: totals.grandTotal,
    },
    include: orderInclude,
  });
}

export async function addItemToOrder(input: {
  orderId: number;
  productId?: number;
  variantId?: number | null;
  quantity: number;
  weightKg?: string | number | null;
  notes?: string | null;
  scannedBarcode?: string | null;
}) {
  let productId = input.productId;
  if (!productId && input.scannedBarcode) {
    const byBarcode = await prisma.product.findFirst({
      where: { barcode: input.scannedBarcode, isActive: true },
      select: { id: true },
    });
    productId = byBarcode?.id;
  }
  if (!productId) throw new ServiceError("Product id or scanned barcode is required");

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
  });
  if (!product) throw new ServiceError("Product not found");

  let unitPrice = product.basePrice;
  if (input.variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: input.variantId, productId, isActive: true },
    });
    if (!variant) throw new ServiceError("Variant not found");
    unitPrice = variant.priceOverride;
  }

  const existing = await prisma.orderItem.findFirst({
    where: {
      orderId: input.orderId,
      productId,
      variantId: input.variantId ?? null,
      status: { not: "Void" },
    },
  });

  if (existing && !product.isWeighted) {
    const quantity = existing.quantity + input.quantity;
    return prisma.orderItem.update({
      where: { id: existing.id },
      data: {
        quantity,
        lineTotal: existing.unitPrice * BigInt(quantity),
      },
      include: { product: true, variant: true },
    });
  }

  const qty = input.quantity;
  const weightKgValue =
    input.weightKg !== undefined && input.weightKg !== null
      ? Number(input.weightKg)
      : null;
  const lineTotal =
    product.isWeighted && weightKgValue !== null
      ? (unitPrice * BigInt(Math.round(weightKgValue * 1000))) / 1000n
      : unitPrice * BigInt(qty);

  return prisma.orderItem.create({
    data: {
      orderId: input.orderId,
      productId,
      variantId: input.variantId ?? null,
      quantity: qty,
      unitPrice,
      lineTotal,
      notes: input.notes ?? null,
      weightKg:
        input.weightKg !== undefined && input.weightKg !== null
          ? String(input.weightKg)
          : null,
      scannedBarcode: input.scannedBarcode ?? null,
    },
    include: { product: true, variant: true },
  });
}

export async function voidOrder(
  input: {
    orderId: number;
    reason: string;
    reverseStock?: boolean;
  } & ManagerApprovalInput,
  txClient?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { orderItems: true, payments: true },
    });
    if (!order) throw new ServiceError("Order not found");
    assertOrderVoidable(order.status);

    // Authoritative CAS first — same allowlist as assertOrderVoidable.
    // Do not consume approval or apply void effects before the claim succeeds.
    await claimVoidTransition(tx, input.orderId, {
      voidReason: input.reason,
      approvedByUserId:
        input.approvalToken !== undefined
          ? null
          : (input.approvedByUserId ?? null),
    });

    const approval =
      input.approvalToken !== undefined && input.requester !== undefined
        ? await consumeManagerApprovalGrant(tx, {
            requester: input.requester,
            approvalToken: input.approvalToken,
            action: "order.void",
            resourceType: "order",
            resourceId: input.orderId,
          })
        : { approverUserId: input.approvedByUserId ?? null };

    if (approval.approverUserId !== null) {
      await tx.order.update({
        where: { id: input.orderId },
        data: { approvedByUserId: approval.approverUserId },
      });
    }

    // Re-read committed line/payment state after the claim (no stale pre-claim data
    // for subsequent effects). Existing void behavior does not reverse payments.
    const claimedOrder = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { orderItems: true, payments: true },
    });

    await tx.orderItem.updateMany({
      where: { orderId: input.orderId, status: { not: "Void" } },
      data: { status: "Void", voidReason: input.reason },
    });

    if (input.reverseStock ?? false) {
      for (const item of claimedOrder.orderItems) {
        if (item.status === "Void") continue;
        const qty =
          item.weightKg !== null
            ? new Prisma.Decimal(item.weightKg.toString())
            : new Prisma.Decimal(item.quantity);
        await tx.product.update({
          where: { id: item.productId },
          data: { currentStock: { increment: qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: "Return",
            quantity: qty,
            costAmount: item.unitPrice,
            reference: claimedOrder.orderNumber,
            notes: `Stock reversal for void (${claimedOrder.orderNumber})`,
            userId: approval.approverUserId,
          },
        });
      }
    }

    const updated = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: orderInclude,
    });

    // SEC-05B: voiding an order is transaction-required regardless of the
    // approval path used; the free-text reason stays on the order record and
    // is never copied verbatim into audit metadata.
    await writeRequiredAudit(tx, {
      userId: input.requester?.userId ?? approval.approverUserId ?? null,
      action: "VOID_ORDER",
      recordId: input.orderId,
      newValues: buildOrderVoidAuditMetadata({
        reason: input.reason,
        approvedByUserId: approval.approverUserId,
        stockReversed: input.reverseStock ?? false,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    return updated;
  };

  if (txClient) return run(txClient);
  return prisma.$transaction(run);
}

export async function holdOrder(orderId: number, notes?: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ServiceError("Order not found");
  const suffix = " [HELD]";
  const noteValue =
    notes !== undefined
      ? notes
      : order.notes?.includes(suffix)
        ? order.notes
        : `${order.notes ?? ""}${suffix}`.trim();
  return prisma.order.update({
    where: { id: orderId },
    data: { notes: noteValue },
    include: orderInclude,
  });
}

export async function recallOrder(orderId: number, notes?: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ServiceError("Order not found");
  const cleaned = (order.notes ?? "").replace(" [HELD]", "").trim() || null;
  return prisma.order.update({
    where: { id: orderId },
    data: { notes: notes ?? cleaned },
    include: orderInclude,
  });
}

type DiscountCapItem = {
  lineTotal: bigint;
  product: { maxDiscount: bigint };
};

function capOrderDiscountAmount(
  orderItems: DiscountCapItem[],
  subTotal: bigint,
  requestedDiscount: bigint,
): bigint {
  if (requestedDiscount <= 0n || subTotal <= 0n) return requestedDiscount;

  let cappedTotal = 0n;
  for (const item of orderItems) {
    const proportional = (requestedDiscount * item.lineTotal) / subTotal;
    if (item.product.maxDiscount > 0n && proportional > item.product.maxDiscount) {
      cappedTotal += item.product.maxDiscount;
    } else {
      cappedTotal += proportional;
    }
  }
  return cappedTotal;
}

export async function applyOrderDiscount(
  input: {
    orderId: number;
    discountAmount?: bigint;
    discountPercent?: number;
    reason?: string | null;
  } & ManagerApprovalInput,
  txClient?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        orderItems: {
          where: { status: { not: "Void" } },
          include: { product: { select: { maxDiscount: true } } },
        },
      },
    });
    if (!order) throw new ServiceError("Order not found");
    assertOrderDiscountable(order.status);

    const prior = {
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      grandTotal: order.grandTotal,
    };

    const subTotal = order.orderItems.reduce(
      (sum, item) => sum + item.lineTotal,
      0n,
    );
    let discountAmount =
      input.discountAmount ??
      (input.discountPercent !== undefined
        ? (subTotal * BigInt(Math.round(input.discountPercent * 100))) / 10000n
        : order.discountAmount);

    discountAmount = capOrderDiscountAmount(
      order.orderItems,
      subTotal,
      discountAmount,
    );

    const tax = await resolveTaxRate(order.taxRateId, tx);
    const totals = calculatePaisaTotals({
      subTotal,
      discountAmount,
      taxPercent: tax.taxPercent,
      isInclusive: tax.isInclusive,
      serviceChargeAmount: order.serviceCharge,
      adjustment: order.adjustment,
    });

    // Authoritative Open + prior-financial CAS before approval consumption.
    await claimDiscountMutation(tx, input.orderId, prior, {
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
    });

    let approval: { approverUserId: number | null };
    if (input.approvalToken !== undefined && input.requester !== undefined) {
      approval = await consumeManagerApprovalGrant(tx, {
        requester: input.requester,
        approvalToken: input.approvalToken,
        action: "order.discount",
        resourceType: "order",
        resourceId: input.orderId,
      });
    } else {
      if (
        input.approvedByUserId &&
        !(await hasPermissionInTransaction(
          tx,
          input.approvedByUserId,
          PERMS.APPLY_DISCOUNTS,
          4,
        ))
      ) {
        throw new ServiceError(
          "Approver does not have discount permission",
        );
      }
      approval = { approverUserId: input.approvedByUserId ?? null };
    }

    if (approval.approverUserId !== null) {
      await tx.order.update({
        where: { id: input.orderId },
        data: { approvedByUserId: approval.approverUserId },
      });
    }

    const updated = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: orderInclude,
    });

    // SEC-05B: discounts are transaction-required regardless of the approval
    // path used; free-text reasons are summarized, never stored verbatim.
    await writeRequiredAudit(tx, {
      userId: input.requester?.userId ?? approval.approverUserId ?? null,
      action: "APPLY_ORDER_DISCOUNT",
      recordId: input.orderId,
      newValues: buildOrderDiscountAuditMetadata({
        discountAmount: input.discountAmount,
        discountPercent: input.discountPercent,
        reason: input.reason,
        approvedByUserId: approval.approverUserId,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });
    return updated;
  };

  if (txClient) return run(txClient);
  return prisma.$transaction(run);
}

type ManagerApprovalInput =
  | {
      approvalToken: string;
      requester: ManagerApprovalRequester;
      auditIpAddress?: string | null;
      approvedByUserId?: never;
    }
  | {
      approvedByUserId?: number;
      approvalToken?: never;
      requester?: never;
      auditIpAddress?: never;
    };

export async function buildReceiptData(orderId: number) {
  const order = await getOrderById(orderId);
  if (!order) throw new ServiceError("Order not found");
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    status: order.status,
    orderType: order.orderType,
    createdAt: order.createdAt,
    items: order.orderItems.map((item) => ({
      id: item.id,
      name: item.product.name,
      quantity: item.quantity,
      weightKg: item.weightKg,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    totals: {
      subTotal: order.subTotal,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      serviceCharge: order.serviceCharge,
      adjustment: order.adjustment,
      grandTotal: order.grandTotal,
    },
    payments: order.payments.map((payment) => ({
      id: payment.id,
      method: payment.paymentMethod.name,
      amount: payment.amount,
      tenderedAmount: payment.tenderedAmount,
      changeAmount: payment.changeAmount,
      referenceNo: payment.referenceNo,
    })),
    customer: order.customer
      ? {
          id: order.customer.id,
          name: order.customer.name,
          phone: order.customer.phone,
        }
      : null,
    ...(order.orderType === "Delivery"
      ? {
          deliveryNote: order.deliveryAddress ?? order.notes ?? null,
          driverName: order.driver?.name ?? null,
          driverPhone: order.driver?.phone ?? null,
        }
      : {}),
  };
}

export async function refundOrder(
  input: {
    orderId: number;
    reason: string;
    amount?: bigint;
    paymentMethodId: number;
    terminalId: number;
    cashierId: number;
    referenceNo?: string | null;
    auditIpAddress?: string | null;
  },
  txClient?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    await acquireClosedOrderWrite(tx, input.orderId);
    await assertNoLegacyNullLineageReturns(tx, input.orderId);

    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        payments: true,
        shift: true,
        orderItems: {
          where: { status: { not: "Void" } },
          include: { product: true },
        },
      },
    });
    if (!order) throw new ServiceError("Order not found");
    if (order.status !== "Closed") {
      throw new ServiceError(
        "Only closed orders can be refunded",
        "ORDER_NOT_REFUNDABLE",
        409,
      );
    }

    const amount = input.amount ?? order.grandTotal;
    if (amount <= 0n) throw new ServiceError("Refund amount must be positive");
    if (amount > order.grandTotal) {
      throw new ServiceError("Refund amount cannot exceed order grand total");
    }

    const alreadyRefunded = await sumCommittedRefundAbsolute(tx, order.id);
    const remaining = remainingRefundableAmount(order.grandTotal, alreadyRefunded);
    assertRefundWithinRemaining(amount, remaining);

    // Existing rule: refund restores full sold quantity per line. Claim that
    // quantity so concurrent returns cannot restore the same units.
    const quantityClaims = order.orderItems.map((item) => ({
      orderItemId: item.id,
      claimQty: item.quantity,
    }));
    await claimSourceReturnQuantities(tx, order.id, quantityClaims);

    const refundOrderRecord = await createOrderWithUniqueNumber(
      (orderNumber) =>
        tx.order.create({
          data: {
            orderNumber,
            orderType: "Refund",
            status: "Closed",
            customerId: order.customerId,
            cashierId: input.cashierId,
            subTotal: -amount,
            grandTotal: -amount,
            notes: `Refund for ${order.orderNumber}: ${input.reason}`,
            terminalId: input.terminalId,
            shiftId: order.shiftId,
            originalOrderId: order.id,
          },
        }),
      tx,
    );

    for (const item of order.orderItems) {
      const unitPrice =
        item.lineTotal / BigInt(Math.max(1, item.quantity));
      const lineTotal = unitPrice * BigInt(item.quantity);
      await tx.orderItem.create({
        data: {
          orderId: refundOrderRecord.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: -item.quantity,
          unitPrice,
          lineTotal: -lineTotal,
          notes: input.reason,
          status: "Closed",
          sourceOrderItemId: item.id,
        },
      });

      const qtyToRestore =
        item.weightKg !== null
          ? new Prisma.Decimal(item.weightKg.toString())
          : new Prisma.Decimal(item.quantity);

      await tx.product.update({
        where: { id: item.productId },
        data: { currentStock: { increment: qtyToRestore } },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: "Return",
          quantity: qtyToRestore,
          costAmount: item.product.costPrice,
          reference: order.orderNumber,
          notes: `Refund stock restore: ${input.reason}`,
          userId: input.cashierId,
        },
      });
    }

    if (order.customerId) {
      const loyaltyPointsPerPkr = await getAppSettingInt(
        "LoyaltyPointsPerPKR",
        1,
        tx,
      );
      const fullPointsEarned = BigInt(
        Math.floor(Number(order.grandTotal / 100n) * loyaltyPointsPerPkr),
      );
      const pointsToClawBack =
        order.grandTotal > 0n
          ? (fullPointsEarned * amount) / order.grandTotal
          : 0n;

      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          totalSpent: { decrement: amount },
          ...(pointsToClawBack > 0n
            ? { loyaltyPoints: { decrement: pointsToClawBack } }
            : {}),
        },
      });

      if (pointsToClawBack > 0n) {
        await tx.loyaltyTransaction.create({
          data: {
            customerId: order.customerId,
            type: "Adjust",
            points: -pointsToClawBack,
            orderId: order.id,
            description: `Loyalty reversal for refund on ${order.orderNumber}`,
          },
        });
      }

      const customer = await tx.customer.findUnique({
        where: { id: order.customerId },
      });
      if (customer) {
        const tier = await resolveCustomerTier(customer.totalSpent, tx);
        await tx.customer.update({
          where: { id: order.customerId },
          data: { tier },
        });
      }
    }

    const payment = await tx.payment.create({
      data: {
        orderId: refundOrderRecord.id,
        paymentMethodId: input.paymentMethodId,
        amount: -amount,
        tenderedAmount: 0n,
        changeAmount: 0n,
        referenceNo: input.referenceNo ?? null,
        status: "Refunded",
      },
      include: { paymentMethod: true },
    });

    const refundMethod = await tx.paymentMethod.findUnique({
      where: { id: input.paymentMethodId },
    });

    const activeShift = await tx.shift.findFirst({
      where: {
        userId: input.cashierId,
        endedAt: null,
        isActive: true,
        ...(order.shiftId ? { id: order.shiftId } : {}),
      },
    });

    if (activeShift && refundMethod) {
      await tx.cashDrawerLog.create({
        data: {
          shiftId: activeShift.id,
          type: "Refund",
          amount,
          description: refundDrawerDescription(order.orderNumber, refundMethod),
          orderId: refundOrderRecord.id,
          userId: input.cashierId,
        },
      });
    }

    await writeRequiredAudit(tx, {
      userId: input.cashierId,
      action: "REFUND_ORDER",
      recordId: order.id,
      newValues: buildOrderRefundAuditMetadata({
        amount,
        paymentMethodId: input.paymentMethodId,
        reason: input.reason,
        refundOrderId: refundOrderRecord.id,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    return {
      orderId: order.id,
      refundOrderId: refundOrderRecord.id,
      payment,
    };
  };

  if (txClient) return run(txClient);
  return prisma.$transaction(run);
}

export async function updateItemQuantity(orderItemId: number, quantity: number) {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
  });
  if (!item) throw new ServiceError("Order item not found");

  if (quantity <= 0) {
    await prisma.orderItem.delete({ where: { id: orderItemId } });
    return null;
  }

  return prisma.orderItem.update({
    where: { id: orderItemId },
    data: {
      quantity,
      lineTotal: item.unitPrice * BigInt(quantity),
    },
    include: { product: true, variant: true },
  });
}

export async function removeOrderItem(
  orderItemId: number,
  voidReason?: string | null,
) {
  return prisma.orderItem.update({
    where: { id: orderItemId },
    data: { status: "Void", voidReason: voidReason ?? null },
    include: { product: true, variant: true },
  });
}

export async function getOpenOrders() {
  return prisma.order.findMany({
    where: {
      status: { in: ["Open", "PartiallyPaid", "Packed", "OutForDelivery"] },
    },
    orderBy: { createdAt: "desc" },
    include: orderInclude,
  });
}

export async function getBillingHistory(
  start: Date,
  end: Date,
  cashierId?: number,
) {
  return prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: { in: ["Closed", "Void"] },
      ...(cashierId ? { cashierId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: orderInclude,
  });
}

export async function getOrdersByDate(start: Date, end: Date) {
  return prisma.order.findMany({
    where: { createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    include: orderInclude,
  });
}

type TaxRateStore = Pick<Prisma.TransactionClient, "appSetting" | "taxRate">;

async function resolveDefaultTaxRateId(
  store: TaxRateStore = prisma,
): Promise<number | null> {
  const setting = await store.appSetting.findUnique({
    where: { key: "DefaultTaxRateId" },
  });
  if (!setting?.value) return null;
  const id = Number.parseInt(setting.value, 10);
  return Number.isFinite(id) ? id : null;
}

async function resolveTaxRate(
  taxRateId: number | null | undefined,
  store: TaxRateStore = prisma,
) {
  const id = taxRateId ?? (await resolveDefaultTaxRateId(store));
  if (!id) return { taxPercent: 0, isInclusive: false };
  const taxRate = await store.taxRate.findFirst({
    where: { id, isActive: true },
  });
  if (!taxRate) return { taxPercent: 0, isInclusive: false };
  return {
    taxPercent: Number(taxRate.rate),
    isInclusive: taxRate.isInclusive,
  };
}

async function hasPermissionInTransaction(
  transaction: Prisma.TransactionClient,
  userId: number,
  permissionName: string,
  minimumLevel: number,
) {
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: {
      role: {
        select: {
          rolePermissions: {
            where: {
              permission: { name: permissionName, isActive: true },
            },
            select: { accessLevel: true },
            take: 1,
          },
        },
      },
    },
  });
  return (user?.role.rolePermissions[0]?.accessLevel ?? 0) >= minimumLevel;
}

export async function applyOrderTax(orderId: number, taxRateId: number) {
  const taxRate = await prisma.taxRate.findFirst({
    where: { id: taxRateId, isActive: true },
  });
  if (!taxRate) throw new ServiceError("Tax rate not found");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: { where: { status: { not: "Void" } } } },
  });
  if (!order) throw new ServiceError("Order not found");

  const subTotal = order.orderItems.reduce((sum, item) => sum + item.lineTotal, 0n);
  const totals = calculatePaisaTotals({
    subTotal,
    discountAmount: order.discountAmount,
    taxPercent: Number(taxRate.rate),
    isInclusive: taxRate.isInclusive,
    serviceChargeAmount: order.serviceCharge,
    adjustment: order.adjustment,
  });

  return prisma.order.update({
    where: { id: orderId },
    data: {
      taxRateId,
      subTotal: totals.subTotal,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
    },
    include: orderInclude,
  });
}

export async function applyPartialPayment(
  input: {
    orderId: number;
    paymentMethodId: number;
    amount: bigint;
    referenceNo?: string | null;
    userId: number;
    auditIpAddress?: string | null;
  },
  txClient?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    // P0-B: claim a payable order write before trusting payment aggregates.
    await acquirePayableOrderWrite(tx, input.orderId);

    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        payments: true,
        orderItems: {
          where: { status: { not: "Void" } },
          include: { product: true },
        },
      },
    });
    if (!order) throw new ServiceError("Order not found");
    if (order.status !== "Open" && order.status !== "PartiallyPaid") {
      throw new ServiceError(
        "Order must be Open or PartiallyPaid",
        "ORDER_NOT_PAYABLE",
        409,
      );
    }

    const paymentMethod = await tx.paymentMethod.findUnique({
      where: { id: input.paymentMethodId },
    });
    if (!paymentMethod?.isActive) {
      throw new ServiceError("Payment method not found");
    }

    const paidSoFar = sumPaymentAmounts(order.payments);
    const remaining = remainingBalance(order.grandTotal, paidSoFar);
    assertPaymentWithinRemaining(input.amount, remaining);

    await tx.payment.create({
      data: {
        orderId: order.id,
        paymentMethodId: input.paymentMethodId,
        amount: input.amount,
        tenderedAmount: input.amount,
        changeAmount: 0n,
        referenceNo: input.referenceNo ?? null,
        status: "Partial",
      },
    });

    const paidTotal = paidSoFar + input.amount;
    const isFullyPaid = paidTotal >= order.grandTotal;

    if (isFullyPaid) {
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: { status: "Paid" },
      });

      await claimOrderClosedFromPayable(tx, order.id);

      await processOrderCompletion(tx, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        cashierId: input.userId,
        grandTotal: order.grandTotal,
        customerId: order.customerId,
        orderItems: order.orderItems,
      });
    } else {
      await claimOrderPartiallyPaid(tx, order.id);
    }

    if (order.shiftId) {
      await createSaleDrawerLog(tx, {
        shiftId: order.shiftId,
        orderId: order.id,
        userId: input.userId,
        orderNumber: order.orderNumber,
        paymentMethod,
        amount: input.amount,
      });
    }

    await writeRequiredAudit(tx, {
      userId: input.userId,
      action: "PARTIAL_PAYMENT",
      recordId: order.id,
      newValues: buildOrderPartialPaymentAuditMetadata({
        paymentMethodId: input.paymentMethodId,
        amount: input.amount,
        fullyPaid: isFullyPaid,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    const finalOrder = await tx.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
    if (!finalOrder) throw new ServiceError("Order not found after update");

    return {
      order: finalOrder,
      paidTotal,
      remaining: remainingBalance(order.grandTotal, paidTotal),
    };
  };

  if (txClient) return run(txClient);
  return prisma.$transaction(run);
}

export async function listOrdersPaginated(params: {
  page: number;
  pageSize: number;
  scope?: "all" | "today";
  status?: OrderStatus;
  cashierId?: number;
  orderType?: OrderType;
  from?: Date;
  to?: Date;
}) {
  const where: Prisma.OrderWhereInput = { isActive: true };

  if (params.status) where.status = params.status;
  if (params.cashierId) where.cashierId = params.cashierId;
  if (params.orderType) where.orderType = params.orderType;

  if (params.from && params.to) {
    where.createdAt = { gte: params.from, lt: params.to };
  } else if (params.scope !== "all") {
    const { start, end } = localDayRangeFromString(toLocalDateString(new Date()));
    where.createdAt = { gte: start, lt: end };
  }

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: orderInclude,
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize };
}

export async function exportOrders(params: {
  from?: Date;
  to?: Date;
  orderType?: OrderType;
  status?: OrderStatus;
  cashierId?: number;
}) {
  const where: Prisma.OrderWhereInput = { isActive: true };
  if (params.from && params.to) {
    where.createdAt = { gte: params.from, lt: params.to };
  }
  if (params.orderType) where.orderType = params.orderType;
  if (params.status) where.status = params.status;
  if (params.cashierId) where.cashierId = params.cashierId;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true, phone: true } },
      cashier: { select: { fullName: true } },
      _count: { select: { orderItems: true } },
    },
  });

  const closed = orders.filter((o) => o.status === "Closed");
  const voided = orders.filter((o) => o.status === "Void");
  const totalRevenue = closed.reduce((sum, o) => sum + o.grandTotal, 0n);

  return {
    generatedAt: new Date().toISOString(),
    filters: params,
    summary: {
      totalOrders: orders.length,
      totalRevenue,
      voidedOrders: voided.length,
    },
    orders: orders.map((order) => ({
      orderNumber: order.orderNumber,
      type: order.orderType,
      status: order.status,
      customer: order.customer
        ? { name: order.customer.name, phone: order.customer.phone }
        : null,
      cashier: order.cashier?.fullName ?? null,
      itemCount: order._count.orderItems,
      grandTotal: order.grandTotal,
      grandTotalFormatted: formatPKR(order.grandTotal),
      createdAt: order.createdAt,
    })),
  };
}

export async function getOrdersByStatus(
  status:
    | "OutForDelivery"
    | "Delivered"
    | "Packed"
    | "Open"
    | "PartiallyPaid"
    | "Closed"
    | "Void",
) {
  return prisma.order.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    include: orderInclude,
  });
}

export async function dispatchOrder(input: {
  orderId: number;
  driverId: number;
  estimatedDelivery?: string | null;
  deliveryAddress?: string | null;
}) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new ServiceError("Order not found");
  if (order.orderType !== "Delivery") {
    throw new ServiceError("Only delivery orders can be dispatched");
  }
  if (order.status !== "Packed" && order.status !== "Open") {
    throw new ServiceError("Order must be Open or Packed to dispatch");
  }

  const driver = await prisma.employee.findFirst({
    where: { id: input.driverId, isActive: true },
  });
  if (!driver) throw new ServiceError("Driver not found");

  return prisma.order.update({
    where: { id: input.orderId },
    data: {
      status: "OutForDelivery",
      driverId: input.driverId,
      ...(input.estimatedDelivery
        ? { deliverySlot: new Date(input.estimatedDelivery) }
        : {}),
      ...(input.deliveryAddress !== undefined
        ? { deliveryAddress: input.deliveryAddress }
        : {}),
    },
    include: orderInclude,
  });
}

export async function markOrderDelivered(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ServiceError("Order not found");
  if (order.status !== "OutForDelivery") {
    throw new ServiceError("Order must be OutForDelivery to mark delivered");
  }

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: "Delivered",
      deliveredAt: new Date(),
    },
    include: orderInclude,
  });
}

export async function searchOrders(params: {
  q: string;
  page: number;
  pageSize: number;
}) {
  const query = params.q.trim();
  const where = {
    isActive: true,
    OR: [
      { orderNumber: { contains: query } },
      { customer: { name: { contains: query } } },
      { customer: { phone: { contains: query } } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        customer: { select: { name: true, phone: true } },
        _count: { select: { orderItems: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      orderType: row.orderType,
      grandTotal: row.grandTotal,
      createdAt: row.createdAt,
      customer: row.customer
        ? { name: row.customer.name, phone: row.customer.phone }
        : null,
      itemCount: row._count.orderItems,
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function returnOrderItems(
  input: {
    orderId: number;
    items: Array<{ orderItemId: number; returnQty: number; reason: string }>;
    refundAmount: bigint;
    cashierId: number;
    auditIpAddress?: string | null;
  },
  txClient?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    await acquireClosedOrderWrite(tx, input.orderId);
    await assertNoLegacyNullLineageReturns(tx, input.orderId);

    const sourceOrder = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        orderItems: { where: { status: { not: "Void" } } },
        payments: { include: { paymentMethod: true } },
      },
    });
    if (!sourceOrder) throw new ServiceError("Order not found");
    if (sourceOrder.status !== "Closed") {
      throw new ServiceError(
        "Only closed orders can be returned",
        "ORDER_NOT_REFUNDABLE",
        409,
      );
    }

    const paymentMethodId = sourceOrder.payments[0]?.paymentMethodId;
    if (!paymentMethodId) {
      throw new ServiceError("Source order has no payment method");
    }

    if (input.refundAmount <= 0n) {
      throw new ServiceError("Refund amount must be positive");
    }

    const alreadyRefunded = await sumCommittedRefundAbsolute(tx, sourceOrder.id);
    const remaining = remainingRefundableAmount(
      sourceOrder.grandTotal,
      alreadyRefunded,
    );
    assertRefundWithinRemaining(input.refundAmount, remaining);

    for (const row of input.items) {
      const orderItem = sourceOrder.orderItems.find(
        (item) => item.id === row.orderItemId,
      );
      if (!orderItem) {
        throw new ServiceError(
          `Order item ${row.orderItemId} not found`,
          "ORDER_ITEM_NOT_RETURNABLE",
          409,
        );
      }
      if (row.returnQty > orderItem.quantity) {
        throw new ServiceError(
          `Return quantity exceeds original for item ${row.orderItemId}`,
          "RETURN_QUANTITY_EXCEEDS_REMAINING",
          409,
        );
      }
    }

    await claimSourceReturnQuantities(
      tx,
      sourceOrder.id,
      input.items.map((row) => ({
        orderItemId: row.orderItemId,
        claimQty: row.returnQty,
      })),
    );

    const refundOrder = await createOrderWithUniqueNumber(
      (orderNumber) =>
        tx.order.create({
          data: {
            orderNumber,
            orderType: "Refund",
            status: "Closed",
            customerId: sourceOrder.customerId,
            cashierId: input.cashierId,
            subTotal: -input.refundAmount,
            grandTotal: -input.refundAmount,
            notes: `Return for ${sourceOrder.orderNumber}`,
            terminalId: sourceOrder.terminalId,
            shiftId: sourceOrder.shiftId,
            originalOrderId: sourceOrder.id,
          },
        }),
      tx,
    );

    for (const row of input.items) {
      const orderItem = sourceOrder.orderItems.find(
        (item) => item.id === row.orderItemId,
      )!;
      const unitPrice =
        orderItem.lineTotal / BigInt(Math.max(1, orderItem.quantity));
      const lineTotal = unitPrice * BigInt(row.returnQty);

      await tx.orderItem.create({
        data: {
          orderId: refundOrder.id,
          productId: orderItem.productId,
          variantId: orderItem.variantId,
          quantity: -row.returnQty,
          unitPrice,
          lineTotal: -lineTotal,
          notes: row.reason,
          status: "Closed",
          sourceOrderItemId: orderItem.id,
        },
      });

      await tx.product.update({
        where: { id: orderItem.productId },
        data: { currentStock: { increment: row.returnQty } },
      });

      await tx.stockMovement.create({
        data: {
          productId: orderItem.productId,
          type: "Return",
          quantity: new Prisma.Decimal(row.returnQty),
          costAmount: orderItem.unitPrice,
          reference: sourceOrder.orderNumber,
          notes: `Return: ${row.reason}`,
          userId: input.cashierId,
        },
      });
    }

    const payment = await tx.payment.create({
      data: {
        orderId: refundOrder.id,
        paymentMethodId,
        amount: -input.refundAmount,
        tenderedAmount: 0n,
        changeAmount: 0n,
        status: "Refunded",
      },
      include: { paymentMethod: true },
    });

    if (sourceOrder.shiftId) {
      await tx.cashDrawerLog.create({
        data: {
          shiftId: sourceOrder.shiftId,
          type: "Refund",
          amount: input.refundAmount,
          description: `Return for ${sourceOrder.orderNumber}`,
          orderId: refundOrder.id,
          userId: input.cashierId,
        },
      });
    }

    await writeRequiredAudit(tx, {
      userId: input.cashierId,
      action: "RETURN",
      recordId: sourceOrder.id,
      newValues: buildOrderReturnAuditMetadata({
        itemCount: input.items.length,
        refundAmount: input.refundAmount,
        refundOrderId: refundOrder.id,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    return {
      sourceOrderId: sourceOrder.id,
      refundOrderId: refundOrder.id,
      refundOrderNumber: refundOrder.orderNumber,
      payment,
    };
  };

  if (txClient) return run(txClient);
  return prisma.$transaction(run);
}

async function getAppSettingInt(
  key: string,
  fallback: number,
  store: Pick<Prisma.TransactionClient, "appSetting"> = prisma,
): Promise<number> {
  const row = await store.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getAppSettingBigInt(
  key: string,
  fallback: bigint,
  store: Pick<Prisma.TransactionClient, "appSetting"> = prisma,
): Promise<bigint> {
  const row = await store.appSetting.findUnique({ where: { key } });
  if (!row?.value) return fallback;
  try {
    return BigInt(row.value);
  } catch {
    return fallback;
  }
}

async function resolveCustomerTier(
  totalSpent: bigint,
  store: Pick<Prisma.TransactionClient, "appSetting"> = prisma,
): Promise<CustomerTier> {
  const [platinum, gold, silver] = await Promise.all([
    getAppSettingBigInt("TierPlatinumThreshold", 10_000_000n, store),
    getAppSettingBigInt("TierGoldThreshold", 5_000_000n, store),
    getAppSettingBigInt("TierSilverThreshold", 2_000_000n, store),
  ]);

  if (totalSpent >= platinum) return "Platinum";
  if (totalSpent >= gold) return "Gold";
  if (totalSpent >= silver) return "Silver";
  return "Regular";
}

function formatInvoiceNumber(orderId: number, date = new Date()): string {
  const ymd = toLocalDateString(date).replace(/-/g, "");
  return `INV-${ymd}-${orderId}`;
}

export async function applyOrderAdjustment(orderId: number, adjustment: bigint) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: { where: { status: { not: "Void" } } } },
  });
  if (!order) throw new ServiceError("Order not found", "ORDER_NOT_FOUND");
  if (order.status !== "Open") {
    throw new ServiceError("Only open orders can be adjusted", "ORDER_NOT_OPEN");
  }

  const subTotal = order.orderItems.reduce((sum, item) => sum + item.lineTotal, 0n);
  const tax = await resolveTaxRate(order.taxRateId);
  const totals = calculatePaisaTotals({
    subTotal,
    discountAmount: order.discountAmount,
    taxPercent: tax.taxPercent,
    isInclusive: tax.isInclusive,
    serviceChargeAmount: order.serviceCharge,
    adjustment,
  });

  return prisma.order.update({
    where: { id: orderId },
    data: {
      adjustment,
      subTotal: totals.subTotal,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
    },
    include: orderInclude,
  });
}

/**
 * SEC-04A safe metadata input for the generic order update path.
 *
 * This type is intentionally closed: it accepts only plain metadata and no
 * financial, state, payment, item, ownership, or approval fields. Do not widen
 * it to a general record or add protected order fields — privileged actions
 * must use their dedicated services and routes.
 */
export type SafeOrderMetadataInput = {
  notes?: string | null;
  customerId?: number | null;
};

/**
 * Narrow metadata-only update used by the generic `PUT /api/orders/{id}`
 * `updateMeta` action. Builds the Prisma update data explicitly from the
 * typed allowlist; it never interprets values as commands and never touches
 * calculated or protected fields.
 */
export async function updateOrderMetadata(
  orderId: number,
  input: SafeOrderMetadataInput,
) {
  const data: { notes?: string | null; customerId?: number | null } = {};
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.customerId !== undefined) data.customerId = input.customerId;
  if (input.notes === undefined && input.customerId === undefined) {
    throw new ServiceError("No metadata fields provided");
  }

  return prisma.order.update({
    where: { id: orderId },
    data,
    include: orderInclude,
  });
}

export async function updateOrderNotes(orderId: number, notes: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ServiceError("Order not found", "ORDER_NOT_FOUND");

  return prisma.order.update({
    where: { id: orderId },
    data: { notes },
    include: orderInclude,
  });
}

type OrderCompletionItem = {
  productId: number;
  quantity: number;
  weightKg: Prisma.Decimal | null;
  product: { id: number; isWeighted: boolean; costPrice: bigint };
};

type BundleItemPool = {
  productId: number;
  remainingQty: number;
  quantity: number;
  lineTotal: bigint;
};

async function computeSubTotalWithBundles(
  orderItems: Array<{
    productId: number;
    quantity: number;
    lineTotal: bigint;
  }>,
  store: Pick<Prisma.TransactionClient, "promotionBundle"> = prisma,
): Promise<{ subTotal: bigint; bundleNotes: string[] }> {
  if (orderItems.length === 0) {
    return { subTotal: 0n, bundleNotes: [] };
  }

  const bundles = await store.promotionBundle.findMany({
    where: { isActive: true },
    include: { items: { where: { isActive: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });

  const sortedBundles = [...bundles].sort((a, b) => {
    const savingsA = a.originalPrice - a.dealPrice;
    const savingsB = b.originalPrice - b.dealPrice;
    return savingsA > savingsB ? -1 : savingsA < savingsB ? 1 : 0;
  });

  const pools: BundleItemPool[] = orderItems.map((item) => ({
    productId: item.productId,
    remainingQty: item.quantity,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  }));

  let bundleTotal = 0n;
  const bundleNotes: string[] = [];
  let applied = true;

  while (applied) {
    applied = false;
    for (const bundle of sortedBundles) {
      if (bundle.items.length === 0) continue;

      const times = Math.min(
        ...bundle.items.map((bundleItem) => {
          const available = pools
            .filter((pool) => pool.productId === bundleItem.productId)
            .reduce((sum, pool) => sum + pool.remainingQty, 0);
          return Math.floor(available / bundleItem.quantity);
        }),
      );

      if (times < 1) continue;

      for (const bundleItem of bundle.items) {
        let remainingToConsume = bundleItem.quantity * times;
        for (const pool of pools) {
          if (pool.productId !== bundleItem.productId || pool.remainingQty <= 0) {
            continue;
          }
          const take = Math.min(pool.remainingQty, remainingToConsume);
          pool.remainingQty -= take;
          remainingToConsume -= take;
          if (remainingToConsume <= 0) break;
        }
      }

      bundleTotal += bundle.dealPrice * BigInt(times);
      bundleNotes.push(`Promotion bundle "${bundle.name}" x${times}`);
      applied = true;
      break;
    }
  }

  const regularTotal = pools.reduce((sum, pool) => {
    if (pool.remainingQty <= 0 || pool.quantity <= 0) return sum;
    return sum + (pool.lineTotal * BigInt(pool.remainingQty)) / BigInt(pool.quantity);
  }, 0n);

  return { subTotal: bundleTotal + regularTotal, bundleNotes };
}

async function processOrderCompletion(
  tx: Prisma.TransactionClient,
  input: {
    orderId: number;
    orderNumber: string;
    cashierId: number;
    grandTotal: bigint;
    customerId?: number | null;
    redeemPoints?: bigint;
    orderItems: OrderCompletionItem[];
  },
) {
  for (const item of input.orderItems) {
    const product = item.product;
    const qtyToDeduct =
      product.isWeighted && item.weightKg
        ? new Prisma.Decimal(item.weightKg.toString())
        : new Prisma.Decimal(item.quantity);

    await tx.product.update({
      where: { id: product.id },
      data: { currentStock: { decrement: qtyToDeduct } },
    });

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        type: "Sale",
        quantity: qtyToDeduct.negated(),
        costAmount: product.costPrice,
        reference: input.orderNumber,
        notes: `Sale on checkout (${input.orderNumber})`,
        userId: input.cashierId,
      },
    });
  }

  const customerId = input.customerId;
  if (customerId === null || customerId === undefined) {
    await tx.syncQueue.create({
      data: {
        tableName: "orders",
        recordId: input.orderId,
        operation: "CHECKOUT",
        payload: JSON.stringify({
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          grandTotal: input.grandTotal.toString(),
        }),
        status: "Pending",
        retries: 0,
      },
    });
    return;
  }

  const loyaltyPointsPerPkr = await getAppSettingInt(
    "LoyaltyPointsPerPKR",
    1,
    tx,
  );
  const pointsEarned = BigInt(
    Math.floor(Number(input.grandTotal / 100n) * loyaltyPointsPerPkr),
  );
  const redeemPoints = input.redeemPoints ?? 0n;

  await tx.customer.update({
    where: { id: customerId },
    data: {
      totalSpent: { increment: input.grandTotal },
      ...(pointsEarned > 0n ? { loyaltyPoints: { increment: pointsEarned } } : {}),
    },
  });

  if (pointsEarned > 0n) {
    await tx.loyaltyTransaction.create({
      data: {
        customerId,
        type: "Earn",
        points: pointsEarned,
        orderId: input.orderId,
        description: `Earned on ${input.orderNumber}`,
      },
    });
  }

  if (redeemPoints > 0n) {
    await tx.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { decrement: redeemPoints } },
    });
    await tx.loyaltyTransaction.create({
      data: {
        customerId,
        type: "Redeem",
        points: redeemPoints,
        orderId: input.orderId,
        description: `Redeemed on ${input.orderNumber}`,
      },
    });
  }

  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (customer) {
    const tier = await resolveCustomerTier(customer.totalSpent, tx);
    await tx.customer.update({
      where: { id: customerId },
      data: { tier },
    });
  }

  await tx.syncQueue.create({
    data: {
      tableName: "orders",
      recordId: input.orderId,
      operation: "CHECKOUT",
      payload: JSON.stringify({
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        grandTotal: input.grandTotal.toString(),
      }),
      status: "Pending",
      retries: 0,
    },
  });
}

export async function checkoutFast(
  input: {
    orderId: number;
    paymentMethodId?: number;
    tenderedAmount?: bigint;
    terminalId: number;
    cashierId: number;
    discountPercent?: number;
    taxPercent?: number;
    customerId?: number | null;
    notes?: string | null;
    referenceNo?: string | null;
    redeemPoints?: bigint;
    payments?: Array<{
      paymentMethodId: number;
      amount: bigint;
      tenderedAmount?: bigint;
      referenceNo?: string | null;
    }>;
    auditIpAddress?: string | null;
  },
  txClient?: Prisma.TransactionClient,
) {
  const order = await (txClient ?? prisma).order.findUnique({
    where: { id: input.orderId },
    include: {
      orderItems: {
        where: { status: { not: "Void" } },
        include: { product: true, variant: true },
      },
    },
  });

  if (!order) throw new ServiceError("Order not found");
  if (order.status !== "Open") {
    throw new ServiceError("Order is not open", "ORDER_NOT_OPEN", 409);
  }
  if (order.orderItems.length === 0) throw new ServiceError("Order has no items");

  const openShift = await (txClient ?? prisma).shift.findFirst({
    where: {
      userId: input.cashierId,
      terminalId: input.terminalId,
      endedAt: null,
      isActive: true,
    },
  });
  if (!openShift) {
    throw new ServiceError("No open shift for this terminal");
  }

  const discountPercent = input.discountPercent ?? 0;
  const tax =
    input.taxPercent !== undefined
      ? { taxPercent: input.taxPercent, isInclusive: false }
      : await resolveTaxRate(order.taxRateId, txClient ?? prisma);

  const { subTotal, bundleNotes } = await computeSubTotalWithBundles(
    order.orderItems,
    txClient ?? prisma,
  );
  const bundleNoteText =
    bundleNotes.length > 0
      ? `Bundles applied: ${bundleNotes.join("; ")}`
      : null;
  const checkoutNotes =
    bundleNoteText !== null
      ? input.notes
        ? `${input.notes}\n${bundleNoteText}`
        : bundleNoteText
      : input.notes;

  let discountAmount =
    discountPercent > 0
      ? (subTotal * BigInt(Math.round(discountPercent))) / 100n
      : order.discountAmount;

  discountAmount = capOrderDiscountAmount(order.orderItems, subTotal, discountAmount);

  const customerId = input.customerId ?? order.customerId;
  const redeemPoints = input.redeemPoints ?? 0n;
  if (redeemPoints > 0n && customerId) {
    const customer = await (txClient ?? prisma).customer.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw new ServiceError("Customer not found");
    if (customer.loyaltyPoints < redeemPoints) {
      throw new ServiceError("Insufficient loyalty points");
    }
    const redeemRate = await getAppSettingInt(
      "LoyaltyRedeemRate",
      100,
      txClient ?? prisma,
    );
    const redeemDiscount = (redeemPoints / BigInt(Math.max(1, redeemRate))) * 100n;
    discountAmount += redeemDiscount;
  }

  const serviceChargePercent = await getAppSettingInt(
    "ServiceChargePercent",
    0,
    txClient ?? prisma,
  );
  const totals = calculatePaisaTotals({
    subTotal,
    discountAmount,
    taxPercent: tax.taxPercent,
    isInclusive: tax.isInclusive,
    serviceChargePercent,
    adjustment: order.adjustment,
  });

  const paymentRows =
    input.payments && input.payments.length > 0
      ? input.payments
      : input.paymentMethodId && input.tenderedAmount !== undefined
        ? [
            {
              paymentMethodId: input.paymentMethodId,
              amount: totals.grandTotal,
              tenderedAmount: input.tenderedAmount,
              referenceNo: input.referenceNo,
            },
          ]
        : [];

  if (paymentRows.length === 0) {
    throw new ServiceError("At least one payment is required");
  }

  const paidTotal = paymentRows.reduce((sum, row) => sum + row.amount, 0n);
  if (paidTotal !== totals.grandTotal) {
    throw new ServiceError("Split payment total must equal grand total");
  }

  const runWrites = async (tx: Prisma.TransactionClient) => {
    // P0-B: authoritative re-read + conditional Open → Closed before side effects.
    const liveOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true },
    });
    if (!liveOrder || liveOrder.status !== "Open") {
      throw new ServiceError("Order is not open", "ORDER_NOT_OPEN", 409);
    }

    await claimCheckoutCompletion(tx, order.id, {
      ...(checkoutNotes !== undefined ? { notes: checkoutNotes } : {}),
      ...(customerId !== null && customerId !== undefined
        ? { customerId }
        : {}),
      subTotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      serviceCharge: totals.serviceCharge,
      grandTotal: totals.grandTotal,
      shiftId: openShift.id,
      terminalId: input.terminalId,
      cashierId: input.cashierId,
      invoiceNumber: formatInvoiceNumber(order.id),
    });

    for (const paymentRow of paymentRows) {
      const paymentMethod = await tx.paymentMethod.findUnique({
        where: { id: paymentRow.paymentMethodId },
      });
      if (!paymentMethod || !paymentMethod.isActive) {
        throw new ServiceError("Payment method not found");
      }

      const isCash =
        paymentMethod.code?.toUpperCase() === "CASH" ||
        paymentMethod.name.toLowerCase().includes("cash");
      const tenderedAmount =
        paymentRow.tenderedAmount ?? (isCash ? paymentRow.amount : paymentRow.amount);
      const changeAmount = isCash ? tenderedAmount - paymentRow.amount : 0n;
      if (isCash && tenderedAmount < paymentRow.amount) {
        throw new ServiceError("Cash tendered amount is less than payment amount");
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          paymentMethodId: paymentRow.paymentMethodId,
          amount: paymentRow.amount,
          tenderedAmount,
          changeAmount,
          referenceNo: paymentRow.referenceNo ?? null,
          status: "Paid",
        },
      });

      await createSaleDrawerLog(tx, {
        shiftId: openShift.id,
        orderId: order.id,
        userId: input.cashierId,
        orderNumber: order.orderNumber,
        paymentMethod,
        amount: paymentRow.amount,
      });
    }

    await processOrderCompletion(tx, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      cashierId: input.cashierId,
      grandTotal: totals.grandTotal,
      customerId,
      redeemPoints,
      orderItems: order.orderItems,
    });

    await writeRequiredAudit(tx, {
      userId: input.cashierId,
      action: "CHECKOUT",
      recordId: order.id,
      newValues: buildOrderCheckoutAuditMetadata({
        terminalId: input.terminalId,
        paymentMethodIds: paymentRows.map((row) => row.paymentMethodId),
        grandTotal: totals.grandTotal,
      }),
      ipAddress: input.auditIpAddress ?? null,
    });

    return tx.order.findUnique({
      where: { id: order.id },
      include: {
        ...orderInclude,
        orderItems: {
          include: { product: true, variant: true },
        },
        payments: { include: { paymentMethod: true } },
      },
    });
  };

  if (txClient) return runWrites(txClient);
  return prisma.$transaction(runWrites);
}

export async function getShiftOrders(
  shiftId: number,
  page: number,
  pageSize: number,
) {
  const where = { shiftId, isActive: true };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        _count: { select: { orderItems: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const summaryAgg = await prisma.order.aggregate({
    where: { shiftId, isActive: true, status: "Closed" },
    _count: { id: true },
    _sum: { grandTotal: true },
  });

  return {
    items: rows.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      grandTotal: order.grandTotal,
      createdAt: order.createdAt,
      customer: order.customer ? { name: order.customer.name } : null,
      itemCount: order._count.orderItems,
    })),
    total,
    page,
    pageSize,
    summary: {
      totalOrders: summaryAgg._count.id,
      totalRevenue: summaryAgg._sum.grandTotal ?? 0n,
    },
  };
}
