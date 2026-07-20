import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { resolveClientIp } from "@/lib/client-ip";
import { parseJsonBody } from "@/lib/api/http";
import { prisma } from "@/lib/prisma";
import {
  changeOwnPassword,
  PasswordChangeError,
} from "@/lib/services/password-service";
import { changePasswordSchema } from "@/lib/validators/auth.validators";

export async function POST(request: Request) {
  const auth = await requireSession({ allowPasswordChangeRequired: true });
  if (auth.error) return auth.error;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return fail("Request body is too large", "PAYLOAD_TOO_LARGE", 413);
  }

  const parsed = changePasswordSchema.safeParse(
    await parseJsonBody<unknown>(request),
  );
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400);
  }

  try {
    const result = await changeOwnPassword(prisma, {
      userId: auth.session.user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      ipAddress: resolveClientIp(request),
    });
    await signOut({ redirect: false });
    return ok({
      passwordChanged: result.passwordChanged,
      reauthenticationRequired: result.reauthenticationRequired,
    });
  } catch (error) {
    if (error instanceof PasswordChangeError) {
      return fail(error.message, error.code, 400);
    }
    return fail("Password change failed", "PASSWORD_CHANGE_FAILED", 500);
  }
}
