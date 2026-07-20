import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  updateTaxRate,
  deleteTaxRate,
} from "@/lib/services/settings-service";
import { updateTaxRateSchema } from "@/lib/validators/settings.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const taxRateId = Number.parseInt(id, 10);
  if (Number.isNaN(taxRateId)) return fail("Invalid tax rate id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = updateTaxRateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await updateTaxRate(taxRateId, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPDATE_TAX_RATE",
    tableName: "tax_rates",
    recordId: taxRateId,
    newValues: parsed.data,
  });
  return ok(updated);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const taxRateId = Number.parseInt(id, 10);
  if (Number.isNaN(taxRateId)) return fail("Invalid tax rate id", "INVALID_ID", 400);
  const updated = await deleteTaxRate(taxRateId);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "DELETE_TAX_RATE",
    tableName: "tax_rates",
    recordId: taxRateId,
  });
  return ok(updated);
}
