import { NextRequest } from "next/server";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { serializeRecord } from "@/lib/api/serialize";
import { fail, ok } from "@/lib/api-response";
import { buildReceiptData } from "@/lib/services/order-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number.parseInt(id, 10);
  if (Number.isNaN(orderId)) return fail("Invalid order id", "INVALID_ORDER_ID", 400);

  try {
    const receipt = await buildReceiptData(orderId);
    return ok(serializeRecord(receipt));
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to build receipt data",
      "REPRINT_FAILED",
      400,
    );
  }
}
