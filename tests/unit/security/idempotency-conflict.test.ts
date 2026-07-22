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

import { serializeRecord } from "@/lib/api/serialize";
import {
  executeFinancialIdempotent,
  IdempotencyConflictError,
} from "@/lib/services/idempotency-service";
import { hashIdempotencyKey } from "@/lib/security/idempotency";
import { applyPartialPayment } from "@/lib/services/order-service";
import {
  createIdempotencyTestDatabase,
  IDEMPOTENCY_TEST_KEY,
  resetIdempotencyTables,
  seedPartialPaymentOrderFixture,
} from "./idempotency-test-database";

describe("idempotency conflict and replay service", () => {
  const database = createIdempotencyTestDatabase("p0a-conflict");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetIdempotencyTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  it("stores only key digests on completed records", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client);
    await executeFinancialIdempotent({
      client: database.client,
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.partial-payment",
      resourceType: "orders",
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 500n,
        referenceNo: null,
      },
      execute: async (tx) => {
        const result = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 500n,
            userId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });

    const row = await database.client.idempotencyRecord.findFirstOrThrow();
    expect(row.keyDigest).toBe(hashIdempotencyKey(IDEMPOTENCY_TEST_KEY));
    expect(row.keyDigest).not.toContain(IDEMPOTENCY_TEST_KEY);
    expect(JSON.stringify(row)).not.toContain(IDEMPOTENCY_TEST_KEY);
    expect(row.responseBody).not.toContain(IDEMPOTENCY_TEST_KEY);
    expect(row.state).toBe("COMPLETED");
    expect(row.responseStatus).toBe(200);
  });

  it("does not invoke execute on payload mismatch", async () => {
    const fixture = await seedPartialPaymentOrderFixture(database.client);
    let executions = 0;
    const base = {
      client: database.client,
      rawKey: IDEMPOTENCY_TEST_KEY,
      operation: "order.partial-payment" as const,
      resourceType: "orders" as const,
      resourceId: fixture.order.id,
      actorUserId: fixture.user.id,
      authoritativeTerminalId: fixture.terminalId,
    };

    await executeFinancialIdempotent({
      ...base,
      requestPayload: {
        orderId: fixture.order.id,
        paymentMethodId: 1,
        amount: 500n,
        referenceNo: null,
      },
      execute: async (tx) => {
        executions += 1;
        const result = await applyPartialPayment(
          {
            orderId: fixture.order.id,
            paymentMethodId: 1,
            amount: 500n,
            userId: fixture.user.id,
          },
          tx,
        );
        return { status: 200, body: serializeRecord(result) };
      },
    });

    await expect(
      executeFinancialIdempotent({
        ...base,
        requestPayload: {
          orderId: fixture.order.id,
          paymentMethodId: 1,
          amount: 700n,
          referenceNo: null,
        },
        execute: async () => {
          executions += 1;
          throw new Error("should not run");
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });

    expect(executions).toBe(1);
    expect(await database.client.payment.count()).toBe(1);
  });

  it("maps conflict errors to stable codes", () => {
    const mismatch = new IdempotencyConflictError(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "mismatch",
    );
    const expired = new IdempotencyConflictError(
      "IDEMPOTENCY_KEY_EXPIRED",
      "expired",
    );
    const inProgress = new IdempotencyConflictError(
      "IDEMPOTENCY_IN_PROGRESS",
      "busy",
    );
    expect(mismatch.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
    expect(expired.code).toBe("IDEMPOTENCY_KEY_EXPIRED");
    expect(inProgress.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });
});
