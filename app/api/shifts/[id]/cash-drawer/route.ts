import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok, paginated } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { buildCashDrawerEntryAuditMetadata } from "@/lib/security/audit-metadata";
import { addCashDrawerEntry, listCashDrawerLogs } from "@/lib/services/shift-service";
import {
  cashDrawerLogQuerySchema,
  cashDrawerLogSchema,
} from "@/lib/validators/shift.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CASH_DRAWER_OPERATIONS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const shiftId = Number.parseInt(id, 10);
  if (Number.isNaN(shiftId)) return fail("Invalid shift id", "INVALID_ID", 400);

  const parsed = cashDrawerLogQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const result = await listCashDrawerLogs({
    shiftId,
    type: parsed.data.type,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });

  return paginated(
    serializeRecord(result.items),
    result.total,
    result.page,
    result.pageSize,
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CASH_DRAWER_OPERATIONS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const shiftId = Number.parseInt(id, 10);
  if (Number.isNaN(shiftId)) return fail("Invalid shift id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = cashDrawerLogSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await addCashDrawerEntry({
    shiftId,
    type: parsed.data.type,
    amount: parsed.data.amount,
    description: parsed.data.description,
    orderId: parsed.data.orderId,
    userId: auth.session.user.id,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CASH_DRAWER_ENTRY",
    recordId: created.id,
    newValues: buildCashDrawerEntryAuditMetadata(parsed.data),
  });
  return ok(created, 201);
}
