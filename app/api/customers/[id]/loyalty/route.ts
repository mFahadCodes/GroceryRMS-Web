import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { getServiceErrorMessage } from "@/lib/api/service-error";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { adjustLoyaltyPoints } from "@/lib/services/customer-service";
import { customerLoyaltyAdjustSchema } from "@/lib/validators/customer.validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 1);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { loyaltyTransactions: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (!customer) return fail("Customer not found", "CUSTOMER_NOT_FOUND", 404);
  return ok(customer);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_CUSTOMERS, 2);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const customerId = Number.parseInt(id, 10);
  if (Number.isNaN(customerId)) return fail("Invalid customer id", "INVALID_ID", 400);
  const body = await parseJsonBody<unknown>(request);
  const parsed = customerLoyaltyAdjustSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  try {
    const updated = await adjustLoyaltyPoints({
      customerId,
      points: parsed.data.points,
      description: parsed.data.description,
      type: parsed.data.type,
    });
    await auditFromRequest(request, {
      userId: auth.session.user.id,
      action: "ADJUST_LOYALTY",
      tableName: "customers",
      recordId: customerId,
      newValues: parsed.data,
    });
    return ok(updated);
  } catch (error) {
    return fail(
      getServiceErrorMessage(error, "Failed to adjust loyalty points"),
      "ADJUST_LOYALTY_FAILED",
      400,
    );
  }
}
