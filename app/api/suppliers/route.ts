import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { listSuppliers, createSupplier } from "@/lib/services/supplier-service";
import { createSupplierSchema } from "@/lib/validators/finance.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_SUPPLIERS, 1);
  if (auth.error) return auth.error;
  return ok(await listSuppliers());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_SUPPLIERS, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createSupplier(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_SUPPLIER",
    tableName: "suppliers",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
