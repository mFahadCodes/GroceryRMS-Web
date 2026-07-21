import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { upsertSetting } from "@/lib/services/settings-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_TAX_DISCOUNTS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const taxRateId = Number.parseInt(id, 10);
  if (Number.isNaN(taxRateId)) return fail("Invalid tax rate id", "INVALID_ID", 400);

  const taxRate = await prisma.taxRate.findFirst({
    where: { id: taxRateId, isActive: true },
  });
  if (!taxRate) return fail("Tax rate not found", "TAX_RATE_NOT_FOUND", 404);

  await upsertSetting(
    "DefaultTaxRateId",
    {
      value: String(taxRateId),
      dataType: "int",
      group: "Tax",
    },
    { actorUserId: auth.session.user.id },
  );

  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "SET_DEFAULT_TAX_RATE",
    recordId: taxRateId,
    newValues: { defaultTaxRateId: taxRateId },
  });

  return ok({ success: true, defaultTaxRateId: taxRateId });
}
