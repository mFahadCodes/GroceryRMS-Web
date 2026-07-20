import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { buildCashDrawerCommand } from "@/lib/services/print-service";
import { printCashDrawerBodySchema } from "@/lib/validators/print.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.CASH_DRAWER_OPERATIONS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = printCashDrawerBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const command = buildCashDrawerCommand();

  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "OPEN_DRAWER",
    tableName: "cash_drawer_logs",
    newValues: {
      command: command.command,
      escpos: command.escpos,
      ...(parsed.data.terminalId !== undefined
        ? { terminalId: parsed.data.terminalId }
        : {}),
    },
  });

  return ok(command);
}
