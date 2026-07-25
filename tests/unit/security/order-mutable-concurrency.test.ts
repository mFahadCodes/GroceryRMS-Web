import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/service-error";
import {
  acquireOpenOrderWrite,
  claimOrderTotalsUpdate,
  MUTABLE_ORDER_STATUSES,
  ORDER_MUTABLE_CONFLICT,
  ORDER_NOT_MUTABLE,
} from "@/lib/security/order-mutable-concurrency";
import {
  createIdempotencyTestDatabase,
  resetMutableOrderTables,
  seedMutableOrderFixture,
} from "./order-mutable-test-database";

describe("order mutable concurrency helpers", () => {
  const database = createIdempotencyTestDatabase("p0f-mutable-concurrency");

  beforeEach(async () => {
    await resetMutableOrderTables(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
  });

  it("MUTABLE_ORDER_STATUSES is Open-only", () => {
    expect([...MUTABLE_ORDER_STATUSES]).toEqual(["Open"]);
  });

  it("acquireOpenOrderWrite succeeds for Open", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await database.client.$transaction(async (tx) => {
      await acquireOpenOrderWrite(tx, fixture.order.id);
    });
  });

  it.each([
    "PartiallyPaid",
    "Packed",
    "OutForDelivery",
    "Delivered",
    "Closed",
    "Void",
  ] as const)("acquireOpenOrderWrite fails for %s", async (status) => {
    const fixture = await seedMutableOrderFixture(database.client, { status });
    await expect(
      database.client.$transaction(async (tx) => {
        await acquireOpenOrderWrite(tx, fixture.order.id);
      }),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
  });

  it("claimOrderTotalsUpdate succeeds when prior matches", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await database.client.$transaction(async (tx) => {
      await claimOrderTotalsUpdate(
        tx,
        fixture.order.id,
        {
          subTotal: fixture.order.subTotal,
          taxAmount: fixture.order.taxAmount,
          grandTotal: fixture.order.grandTotal,
        },
        {
          subTotal: fixture.order.subTotal,
          taxAmount: 1_000n,
          grandTotal: fixture.order.grandTotal + 1_000n,
        },
      );
    });
    const order = await database.client.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(order.taxAmount).toBe(1_000n);
  });

  it("claimOrderTotalsUpdate fails with stale prior (financial conflict)", async () => {
    const fixture = await seedMutableOrderFixture(database.client);
    await expect(
      database.client.$transaction(async (tx) => {
        await claimOrderTotalsUpdate(
          tx,
          fixture.order.id,
          {
            subTotal: fixture.order.subTotal,
            taxAmount: 999n,
            grandTotal: fixture.order.grandTotal,
          },
          {
            subTotal: fixture.order.subTotal,
            taxAmount: 1_000n,
            grandTotal: fixture.order.grandTotal + 1_000n,
          },
        );
      }),
    ).rejects.toMatchObject({
      code: ORDER_MUTABLE_CONFLICT,
      status: 409,
    } satisfies Partial<ServiceError>);
  });

  it("claimOrderTotalsUpdate fails when status changed (not mutable)", async () => {
    const fixture = await seedMutableOrderFixture(database.client, {
      status: "Closed",
    });
    await expect(
      database.client.$transaction(async (tx) => {
        await claimOrderTotalsUpdate(
          tx,
          fixture.order.id,
          {
            subTotal: fixture.order.subTotal,
            taxAmount: fixture.order.taxAmount,
            grandTotal: fixture.order.grandTotal,
          },
          {
            subTotal: fixture.order.subTotal,
            taxAmount: 1_000n,
            grandTotal: fixture.order.grandTotal + 1_000n,
          },
        );
      }),
    ).rejects.toMatchObject({
      code: ORDER_NOT_MUTABLE,
      status: 409,
    } satisfies Partial<ServiceError>);
  });
});
