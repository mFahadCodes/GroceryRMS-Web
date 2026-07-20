import { NextRequest } from "next/server";
import {
  isDateOnlyString,
  localDayRangeFromString,
  localDayRangeFromTo,
  toLocalDateString,
} from "@/lib/date-range";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok, paginated } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createOrder,
  getBillingHistory,
  getOpenOrders,
  getOrdersByDate,
  getOrdersByStatus,
  listOrdersPaginated,
} from "@/lib/services/order-service";
import {
  createOrderSchema,
  orderListQuerySchema,
} from "@/lib/validators/order.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const parsed = orderListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const { status, date, from, to, cashierId, scope, page, pageSize } =
    parsed.data;

  if (status === "open") {
    const orders = await getOpenOrders();
    return ok(serializeRecord(orders));
  }

  if (
    status === "OutForDelivery" ||
    status === "Delivered" ||
    status === "Packed" ||
    status === "PartiallyPaid"
  ) {
    const orders = await getOrdersByStatus(status);
    return ok(serializeRecord(orders));
  }

  if (status === "history" && from && to) {
    const range =
      isDateOnlyString(from) && isDateOnlyString(to)
        ? localDayRangeFromTo(from, to)
        : localDayRangeFromTo(
            toLocalDateString(new Date(from)),
            toLocalDateString(new Date(to)),
          );
    const orders = await getBillingHistory(
      range.start,
      range.end,
      cashierId,
    );
    return ok(serializeRecord(orders));
  }

  if (date || status === "date") {
    const target = date ?? toLocalDateString(new Date());
    const range = isDateOnlyString(target)
      ? localDayRangeFromString(target)
      : localDayRangeFromString(toLocalDateString(new Date(target)));
    const orders = await getOrdersByDate(range.start, range.end);
    return ok(serializeRecord(orders));
  }

  const fromTo =
    from && to
      ? isDateOnlyString(from) && isDateOnlyString(to)
        ? localDayRangeFromTo(from, to)
        : undefined
      : undefined;

  const result = await listOrdersPaginated({
    page,
    pageSize,
    scope: scope ?? "today",
    cashierId,
    from: fromTo?.start,
    to: fromTo?.end,
  });

  return paginated(
    serializeRecord(result.items),
    result.total,
    result.page,
    result.pageSize,
  );
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const order = await createOrder({
      ...parsed.data,
      cashierId: auth.session.user.id,
    });
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "CREATE_ORDER",
      tableName: "orders",
      recordId: order.id,
      newValues: parsed.data,
    });
    return ok(serializeRecord(order), 201);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to create order",
      "CREATE_ORDER_FAILED",
      400,
    );
  }
}
