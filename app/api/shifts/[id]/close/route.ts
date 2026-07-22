import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { buildShiftAuditMetadata } from "@/lib/security/audit-metadata";
import { closeShift } from "@/lib/services/shift-service";
import { shiftCloseBodySchema } from "@/lib/validators/shift.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.OPEN_CLOSE_SHIFT, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const shiftId = Number.parseInt(id, 10);
  if (Number.isNaN(shiftId)) return fail("Invalid shift id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = shiftCloseBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const closed = await closeShift({
    shiftId,
    userId: auth.session.user.id,
    closingBalance: parsed.data.closingBalance,
    notes: parsed.data.notes,
  });
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "SHIFT_CLOSE",
    recordId: shiftId,
    newValues: buildShiftAuditMetadata({
      balance: parsed.data.closingBalance,
      notes: parsed.data.notes,
    }),
  });
  return ok(closed);
}
