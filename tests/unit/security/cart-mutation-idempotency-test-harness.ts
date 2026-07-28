import type { PrismaClient } from "@prisma/client";
import { serializeRecord } from "@/lib/api/serialize";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import {
  addItemToOrder,
  applyOrderAdjustment,
  applyOrderTax,
  updateItemQuantity,
} from "@/lib/services/order-service";
import {
  IDEMPOTENCY_TEST_KEY,
} from "./idempotency-test-database";
import type { seedMutableOrderFixture } from "./order-mutable-test-database";

type MutableFixture = Awaited<ReturnType<typeof seedMutableOrderFixture>>;

export async function runApplyTaxIdempotent(
  client: PrismaClient,
  fixture: MutableFixture,
  options: {
    rawKey?: string;
    taxRateId: number;
    terminalId?: number | null;
  },
) {
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.apply-tax",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: options.terminalId ?? fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      taxRateId: options.taxRateId,
    },
    client,
    execute: async (tx) => {
      const result = await applyOrderTax(
        {
          orderId: fixture.order.id,
          taxRateId: options.taxRateId,
          userId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}

export async function runApplyAdjustmentIdempotent(
  client: PrismaClient,
  fixture: MutableFixture,
  options: {
    rawKey?: string;
    adjustment: bigint;
    terminalId?: number | null;
  },
) {
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.apply-adjustment",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: options.terminalId ?? fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      adjustment: options.adjustment,
    },
    client,
    execute: async (tx) => {
      const result = await applyOrderAdjustment(
        {
          orderId: fixture.order.id,
          adjustment: options.adjustment,
          userId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}

export async function runAddItemIdempotent(
  client: PrismaClient,
  fixture: MutableFixture,
  options: {
    rawKey?: string;
    productId: number;
    quantity: number;
    terminalId?: number | null;
  },
) {
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.add-item",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: options.terminalId ?? fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      productId: options.productId,
      scannedBarcode: null,
      variantId: null,
      quantity: options.quantity,
      weightKg: null,
      notes: null,
    },
    client,
    execute: async (tx) => {
      const result = await addItemToOrder(
        {
          orderId: fixture.order.id,
          productId: options.productId,
          quantity: options.quantity,
          userId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}

export async function runUpdateItemQuantityIdempotent(
  client: PrismaClient,
  fixture: MutableFixture,
  options: {
    rawKey?: string;
    orderItemId: number;
    quantity: number;
    terminalId?: number | null;
  },
) {
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.update-item-quantity",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: options.terminalId ?? fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      orderItemId: options.orderItemId,
      quantity: options.quantity,
    },
    client,
    execute: async (tx) => {
      const result = await updateItemQuantity(
        {
          orderId: fixture.order.id,
          orderItemId: options.orderItemId,
          quantity: options.quantity,
          userId: fixture.user.id,
          auditAction: "PATCH_ORDER_ITEM",
        },
        tx,
      );
      return { status: 200, body: serializeRecord(result) };
    },
  });
}
