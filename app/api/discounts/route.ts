import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok, paginated } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import {
  createDiscount,
  listDiscounts,
} from "@/lib/services/discount-service";
import {
  createDiscountSchema,
  discountListQuerySchema,
} from "@/lib/validators/discounts";

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const parsed = discountListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("Invalid query parameters", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const result = await listDiscounts(parsed.data);
  return paginated(
    serializeRecord(result.items),
    result.total,
    result.page,
    result.limit,
  );
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = createDiscountSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const created = await createDiscount(parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "CREATE_DISCOUNT",
    tableName: "discounts",
    recordId: created.id,
    newValues: parsed.data,
  });
  return ok(serializeRecord(created), 201);
}
