import { NextRequest } from "next/server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/http";
import { fail, ok } from "@/lib/api-response";
import { PIN_SECURITY_POLICY } from "@/lib/security/pin-security-config";
import { loginBodySchema } from "@/lib/validators/auth.validators";

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) {
    return fail("Request payload is too large", "PAYLOAD_TOO_LARGE", 413);
  }
  const body = await parseJsonBody<unknown>(request);
  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const isPinLogin = "pin" in parsed.data;

  try {
    if ("pin" in parsed.data) {
      const result = await signIn("credentials", {
        pin: parsed.data.pin,
        userId: parsed.data.userId,
        loginType: "pin",
        redirect: false,
      });
      const code = new URL(result, request.url).searchParams.get("code");
      if (code === "pin_throttled") {
        const response = fail(
          "PIN verification temporarily unavailable",
          "PIN_VERIFICATION_THROTTLED",
          429,
        );
        response.headers.set(
          "Retry-After",
          String(PIN_SECURITY_POLICY.safeRetryAfterSeconds),
        );
        return response;
      }
      if (code === "pin_security_unavailable") {
        return fail(
          "PIN security is unavailable",
          "PIN_SECURITY_UNAVAILABLE",
          503,
        );
      }
      if (new URL(result, request.url).searchParams.has("error")) {
        return fail(
          "PIN verification failed",
          "PIN_VERIFICATION_FAILED",
          401,
        );
      }
    } else {
      await signIn("credentials", {
        username: parsed.data.username,
        password: parsed.data.password,
        loginType: "password",
        redirect: false,
      });
    }
    return ok({ authenticated: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return fail(
        isPinLogin ? "PIN verification failed" : "Invalid username or password",
        isPinLogin ? "PIN_VERIFICATION_FAILED" : "INVALID_CREDENTIALS",
        401,
      );
    }
    return fail(
      "Login failed",
      "LOGIN_FAILED",
      500,
    );
  }
}
