import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} from "@/lib/services/supplier-service";
import { updateSupplierSchema } from "@/lib/validators/finance.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_SUPPLIERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const supplierId = Number.parseInt(id, 10);
  if (Number.isNaN(supplierId)) return fail("Invalid supplier id", "INVALID_ID", 400);
  const supplier = await getSupplierById(supplierId);
  if (!supplier) return fail("Supplier not found", "SUPPLIER_NOT_FOUND", 404);
  return ok(supplier);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_SUPPLIERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const supplierId = Number.parseInt(id, 10);
  if (Number.isNaN(supplierId)) return fail("Invalid supplier id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updateSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await updateSupplier(supplierId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_SUPPLIER",
    tableName: "suppliers",
    recordId: supplierId,
    newValues: parsed.data,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_SUPPLIERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const supplierId = Number.parseInt(id, 10);
  if (Number.isNaN(supplierId)) return fail("Invalid supplier id", "INVALID_ID", 400);
  const deleted = await deleteSupplier(supplierId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_SUPPLIER",
    tableName: "suppliers",
    recordId: supplierId,
  });
  return ok(deleted);
}
