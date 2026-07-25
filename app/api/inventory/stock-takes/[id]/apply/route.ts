import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { PERMS } from "@/lib/api/permissions";
import { requirePermission } from "@/lib/api/rbac";
import { fail, ok, okFromStoredEnvelope } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { applyStockTake } from "@/lib/services/inventory-service";
import { parseIdempotencyKey } from "@/lib/security/idempotency";
import { ServiceError } from "@/lib/api/service-error";
import { IdempotencyConflictError } from "@/lib/services/idempotency-service";
import { applyStockTakeSchema } from "@/lib/validators/stock-take.validators";
import { serializeRecord } from "@/lib/api/serialize";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(PERMS.MANAGE_INVENTORY, 1);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const stockTakeId = Number.parseInt(id, 10);
  if (Number.isNaN(stockTakeId)) return fail("Invalid stock take id", "INVALID_ID", 400);

  const rawKeyHeader = request.headers.get("idempotency-key");
  const keyParsed = rawKeyHeader ? parseIdempotencyKey(rawKeyHeader) : null;
  if (keyParsed && !keyParsed.ok) {
    return fail(keyParsed.message, keyParsed.code, 400);
  }

  const body = await parseJsonBody<unknown>(request);
  const parsedBody = applyStockTakeSchema.safeParse(body);
  if (!parsedBody.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsedBody.error.flatten());
  }

  try {
    const applied = await applyStockTake(
      stockTakeId,
      parsedBody.data.items,
      auth.session.user.id,
      resolveClientIp(request),
      {
        rawKey: keyParsed?.ok ? keyParsed.key : undefined,
        authoritativeTerminalId: auth.session.authoritative?.terminalId ?? null,
      },
    );

    if ("replayed" in applied && applied.replayed) {
      return okFromStoredEnvelope(applied.responseBody, applied.status, {
        "Idempotency-Replayed": "true",
      });
    }

    const bodyData = "body" in applied ? applied.body : serializeRecord(applied);
    const status = "status" in applied ? applied.status : 200;
    const replayedHeader = "replayed" in applied ? String(applied.replayed) : "false";

    return ok(bodyData, status, { "Idempotency-Replayed": replayedHeader });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return fail(error.message, error.code, 409);
    }
    if (error instanceof ServiceError) {
      return fail(error.message, error.code, error.status);
    }
    return fail(
      error instanceof Error ? error.message : "Failed to apply stock take",
      "APPLY_STOCK_TAKE_FAILED",
      400,
    );
  }
}
