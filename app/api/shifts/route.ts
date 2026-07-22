import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok, paginated } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { buildShiftAuditMetadata } from "@/lib/security/audit-metadata";
import { serializeRecord } from "@/lib/api/serialize";
import {
  closeShift,
  getOpenShift,
  listShifts,
  openShift,
} from "@/lib/services/shift-service";
import {
  shiftActionSchema,
  shiftQuerySchema,
} from "@/lib/validators/shift.validators";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.OPEN_SHIFT, 1);
  if (auth.error) return auth.error;

  const parsed = shiftQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  if (parsed.data.page !== undefined) {
    const result = await listShifts({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize ?? 20,
      userId: parsed.data.userId,
    });
    return paginated(
      result.items,
      result.total,
      result.page,
      result.pageSize,
    );
  }

  const shift = await getOpenShift(
    auth.session.user.id,
    parsed.data.terminalId,
  );

  if (!shift) {
    return ok(null);
  }

  return ok(serializeRecord(shift));
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.OPEN_SHIFT, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = shiftActionSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    if (parsed.data.action === "open") {
      const shift = await openShift({
        userId: auth.session.user.id,
        terminalId: parsed.data.terminalId,
        openingBalance: parsed.data.openingBalance,
        notes: parsed.data.notes,
      });
      await auditFromRequest(request, {
        userId: auth.session.user.id,
        action: "OPEN_SHIFT",
        recordId: shift.id,
        newValues: buildShiftAuditMetadata({
          terminalId: parsed.data.terminalId,
          balance: parsed.data.openingBalance,
          notes: parsed.data.notes,
        }),
      });
      return ok(serializeRecord(shift), 201);
    }

    const shift = await closeShift({
      shiftId: parsed.data.shiftId,
      userId: auth.session.user.id,
      closingBalance: parsed.data.closingBalance,
      notes: parsed.data.notes,
    });
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "CLOSE_SHIFT",
      recordId: shift.id,
      newValues: buildShiftAuditMetadata({
        balance: parsed.data.closingBalance,
        notes: parsed.data.notes,
      }),
    });
    return ok(serializeRecord(shift));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Shift action failed",
      "SHIFT_ACTION_FAILED",
      400,
    );
  }
}
