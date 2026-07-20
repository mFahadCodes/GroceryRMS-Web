import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { verifyUserPin } from "@/lib/services/pin-security-service";
import { validatePinSchema } from "@/lib/validators/auth.validators";

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) {
    return fail("Request payload is too large", "PAYLOAD_TOO_LARGE", 413);
  }
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = validatePinSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const result = await verifyUserPin({
    userId: parsed.data.userId,
    pin: parsed.data.pin,
    clientIp: resolveClientIp(request),
    actorUserId: auth.session.user.id,
  });
  if (result.status === "throttled") {
    const response = fail(
      "PIN verification temporarily unavailable",
      "PIN_VERIFICATION_THROTTLED",
      429,
    );
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
    return response;
  }
  if (result.status === "security-unavailable") {
    return fail("PIN security is unavailable", "PIN_SECURITY_UNAVAILABLE", 503);
  }
  if (result.status === "failed") {
    return fail("PIN verification failed", "PIN_VERIFICATION_FAILED", 401);
  }
  return ok({
    valid: true,
    userId: result.user.id,
    fullName: result.user.fullName,
    role: result.user.roleName,
  });
}
