import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { updatePrinter, deletePrinter } from "@/lib/services/settings-service";
import { updatePrinterSchema } from "@/lib/validators/settings.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRINTERS_TERMINALS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const printerId = Number.parseInt(id, 10);
  if (Number.isNaN(printerId)) return fail("Invalid printer id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updatePrinterSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await updatePrinter(printerId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_PRINTER",
    tableName: "printers",
    recordId: printerId,
    newValues: parsed.data,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_PRINTERS_TERMINALS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const printerId = Number.parseInt(id, 10);
  if (Number.isNaN(printerId)) return fail("Invalid printer id", "INVALID_ID", 400);
  const deleted = await deletePrinter(printerId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_PRINTER",
    tableName: "printers",
    recordId: printerId,
  });
  return ok(deleted);
}
