import { NextRequest } from "next/server";
import { isDateOnlyString, localDayRangeFromTo } from "@/lib/date-range";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { exportOrders } from "@/lib/services/order-service";
import { orderExportQuerySchema } from "@/lib/validators/order.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.VIEW_REPORTS, 1);
  if (auth.error) return auth.error;

  const parsed = orderExportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const fromTo =
    parsed.data.from && parsed.data.to
      ? isDateOnlyString(parsed.data.from) && isDateOnlyString(parsed.data.to)
        ? localDayRangeFromTo(parsed.data.from, parsed.data.to)
        : undefined
      : undefined;

  const data = await exportOrders({
    from: fromTo?.start,
    to: fromTo?.end,
    orderType: parsed.data.type,
    status: parsed.data.status,
    cashierId: parsed.data.cashierId,
  });

  return ok(serializeRecord(data));
}
