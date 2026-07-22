import { serializeRecord } from "@/lib/api/serialize";
import { ServiceError } from "@/lib/api/service-error";
import { executeFinancialIdempotent } from "@/lib/services/idempotency-service";
import { applyPartialPayment, checkoutFast } from "@/lib/services/order-service";
import type { PrismaClient } from "@prisma/client";
import {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";

export const IDEMPOTENCY_TEST_KEY_C = "770e8400-e29b-41d4-a716-446655440002";
export const IDEMPOTENCY_TEST_KEY_D = "880e8400-e29b-41d4-a716-446655440003";

export {
  IDEMPOTENCY_TEST_KEY,
  IDEMPOTENCY_TEST_KEY_B,
  seedCheckoutOrderFixture,
  seedPartialPaymentOrderFixture,
};

export type CheckoutFixture = Awaited<
  ReturnType<typeof seedCheckoutOrderFixture>
>;
export type PartialFixture = Awaited<
  ReturnType<typeof seedPartialPaymentOrderFixture>
>;

export function runCheckoutIdempotent(
  client: PrismaClient,
  fixture: CheckoutFixture,
  options: {
    rawKey?: string;
    tenderedAmount?: bigint;
    paymentMethodId?: number;
  } = {},
) {
  const tenderedAmount = options.tenderedAmount ?? fixture.grandTotal;
  const paymentMethodId = options.paymentMethodId ?? 1;
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.checkout",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      paymentMethodId,
      tenderedAmount,
      terminalId: fixture.terminalId,
    },
    client,
    execute: async (tx) => {
      const order = await checkoutFast(
        {
          orderId: fixture.order.id,
          paymentMethodId,
          tenderedAmount,
          terminalId: fixture.terminalId!,
          cashierId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(order) };
    },
  });
}

export function runPartialIdempotent(
  client: PrismaClient,
  fixture: PartialFixture,
  options: {
    rawKey?: string;
    amount: bigint;
    paymentMethodId?: number;
  },
) {
  const paymentMethodId = options.paymentMethodId ?? 1;
  return executeFinancialIdempotent({
    rawKey: options.rawKey ?? IDEMPOTENCY_TEST_KEY,
    operation: "order.partial-payment",
    resourceType: "orders",
    resourceId: fixture.order.id,
    actorUserId: fixture.user.id,
    authoritativeTerminalId: fixture.terminalId,
    requestPayload: {
      orderId: fixture.order.id,
      paymentMethodId,
      amount: options.amount,
      referenceNo: null,
    },
    client,
    execute: async (tx) => {
      const paymentResult = await applyPartialPayment(
        {
          orderId: fixture.order.id,
          paymentMethodId,
          amount: options.amount,
          userId: fixture.user.id,
        },
        tx,
      );
      return { status: 200, body: serializeRecord(paymentResult) };
    },
  });
}

export function isFinancialConflict(error: unknown): boolean {
  if (error instanceof ServiceError) {
    return error.status === 409;
  }
  if (!(error instanceof Error)) return false;
  return (
    /not open|not payable|financial state changed|exceeds remaining/i.test(
      error.message,
    )
  );
}

export function fulfilledCount(
  results: PromiseSettledResult<unknown>[],
): number {
  return results.filter((result) => result.status === "fulfilled").length;
}

export function rejectedConflicts(
  results: PromiseSettledResult<unknown>[],
): number {
  return results.filter(
    (result) =>
      result.status === "rejected" && isFinancialConflict(result.reason),
  ).length;
}
