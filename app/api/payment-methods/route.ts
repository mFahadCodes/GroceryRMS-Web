import { NextRequest } from "next/server";
import { requireSession } from "@/lib/api/rbac";
import { ok } from "@/lib/api-response";
import { listPaymentMethods } from "@/lib/services/settings-service";

export async function GET(_request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  return ok(await listPaymentMethods());
}
