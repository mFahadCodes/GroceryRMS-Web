import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { serializeRecord } from "@/lib/api/serialize";
import { auditFromRequest } from "@/lib/audit";
import {
  buildPrintableReceipt,
} from "@/lib/services/print-service";
import { getPublicStoreSettings } from "@/lib/services/settings-service";
import { printReceiptBodySchema } from "@/lib/validators/print.validators";

export async function POST(request: NextRequest) {
  const auth = await requirePermission(PERMS.CREATE_ORDERS, 1);
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = printReceiptBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const data = parsed.data.orderId !== undefined
    ? await buildPrintableReceipt(parsed.data.orderId)
    : {
        store: await getPublicStoreSettings(),
        receipt: parsed.data.receiptData,
      };

  const recordId = parsed.data.orderId ?? null;

  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "PRINT_RECEIPT",
    tableName: "orders",
    recordId: recordId ?? undefined,
    newValues: parsed.data.orderId !== undefined
      ? { orderId: parsed.data.orderId }
      : { receiptData: true },
  });

  return ok(serializeRecord(data));
}
