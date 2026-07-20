import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { ServiceError } from "@/lib/api/service-error";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { expireLoyaltyPoints } from "@/lib/services/customer-service";
import { loyaltyExpireSchema } from "@/lib/validators/customer.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = loyaltyExpireSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  try {
    const results = await expireLoyaltyPoints(parsed.data);
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "EXPIRE_LOYALTY_POINTS",
      tableName: "loyalty_transactions",
      newValues: {
        customerId: parsed.data.customerId ?? null,
        pointsToExpire: parsed.data.pointsToExpire?.toString() ?? null,
        affectedCustomers: results.length,
        totalExpired: results
          .reduce((sum, row) => sum + row.expiredPoints, 0n)
          .toString(),
      },
    });
    return ok(serializeRecord(results));
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail(
      error instanceof Error ? error.message : "Failed to expire loyalty points",
      "LOYALTY_EXPIRE_FAILED",
      500,
    );
  }
}
