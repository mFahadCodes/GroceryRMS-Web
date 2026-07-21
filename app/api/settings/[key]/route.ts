import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { auditFromRequest } from "@/lib/audit";
import { serializeRecord } from "@/lib/api/serialize";
import { buildSettingUpsertAuditMetadata } from "@/lib/security/audit-metadata";
import {
  getSettingByKey,
  upsertSetting,
} from "@/lib/services/settings-service";
import { upsertSettingSchema } from "@/lib/validators/settings.validators";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 1);
  if (auth.error) return auth.error;
  const { key } = await context.params;
  const setting = await getSettingByKey(key);
  if (!setting) return fail("Setting not found", "SETTING_NOT_FOUND", 404);
  return ok(serializeRecord(setting));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.SYSTEM_APP_SETTINGS, 1);
  if (auth.error) return auth.error;
  const { key } = await context.params;
  const body = await parseJsonBody<unknown>(request);
  const parsed = upsertSettingSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  const updated = await upsertSetting(key, parsed.data);
  await auditFromRequest(request, {
    userId: auth.session.user.id,
    action: "UPSERT_SETTING",
    tableName: "app_settings",
    recordId: updated.id,
    newValues: buildSettingUpsertAuditMetadata({
      settingKey: key,
      dataType: parsed.data.dataType ?? "string",
      value: parsed.data.value,
    }),
  });
  return ok(serializeRecord(updated));
}
