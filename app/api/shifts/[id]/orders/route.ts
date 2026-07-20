import { NextRequest } from "next/server";
import { z } from "zod";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getShiftOrders } from "@/lib/services/order-service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const shiftId = Number.parseInt(id, 10);
  if (Number.isNaN(shiftId)) return fail("Invalid shift id", "INVALID_ID", 400);

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const result = await getShiftOrders(
    shiftId,
    parsed.data.page,
    parsed.data.pageSize,
  );
  return ok(serializeRecord(result));
}
