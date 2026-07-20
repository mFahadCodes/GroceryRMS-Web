import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { getShiftById } from "@/lib/services/shift-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.OPEN_CLOSE_SHIFT, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const shiftId = Number.parseInt(id, 10);
  if (Number.isNaN(shiftId)) return fail("Invalid shift id", "INVALID_ID", 400);
  const shift = await getShiftById(shiftId);
  if (!shift) return fail("Shift not found", "SHIFT_NOT_FOUND", 404);

  const { expectedBalanceCalculated, ...rest } = shift;
  return ok(
    serializeRecord({
      ...rest,
      expectedBalance: expectedBalanceCalculated.toString(),
    }),
  );
}
