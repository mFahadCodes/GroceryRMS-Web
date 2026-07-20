import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import {
  listPaymentMethods,
  createPaymentMethod,
} from "@/lib/services/settings-service";
import { createPaymentMethodSchema } from "@/lib/validators/settings.validators";

export async function GET(_request: NextRequest) {
  const auth = await requirePermission(PERMS.PROCESS_PAYMENTS, 1);
  if (auth.error) return auth.error;
  return ok(await listPaymentMethods());
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;
  const body = await parseJsonBody<unknown>(request);
  const parsed = createPaymentMethodSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const created = await createPaymentMethod(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_PAYMENT_METHOD",
    tableName: "payment_methods",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(created, 201);
}
