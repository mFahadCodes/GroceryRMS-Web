import { NextRequest } from "next/server";
import { ok } from "@/lib/api-response";
import { getPublicStoreSettings } from "@/lib/services/settings-service";

export async function GET(_request: NextRequest) {
  const data = await getPublicStoreSettings();
  return ok(data);
}
