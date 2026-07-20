import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { listPrinters, createPrinter } from "@/lib/services/settings-service";
import { createPrinterSchema } from "@/lib/validators/settings.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRINTERS_TERMINALS, 1);
  if (auth.error) return auth.error;
  return ok(await listPrinters());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_PRINTERS_TERMINALS, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createPrinterSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createPrinter(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_PRINTER",
    tableName: "printers",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
