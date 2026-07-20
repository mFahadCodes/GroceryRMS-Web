import { NextRequest } from "next/server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/http";
import { fail, ok } from "@/lib/api-response";
import { hashPin } from "@/lib/pin";
import { prisma } from "@/lib/prisma";
import { loginBodySchema } from "@/lib/validators/auth.validators";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<unknown>(request);
  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const isPinLogin = Boolean(parsed.data.pin?.trim());

  if (isPinLogin) {
    const pin = parsed.data.pin!.trim();
    const pinHash = hashPin(pin);
    const username = parsed.data.username?.trim();

    const userByPin = await prisma.user.findFirst({
      where: { pin: pinHash, isActive: true },
      select: { id: true },
    });

    if (!userByPin) {
      if (username) {
        const userByUsername = await prisma.user.findFirst({
          where: { username, isActive: true },
          select: { id: true, pin: true },
        });
        if (userByUsername && !userByUsername.pin) {
          return fail("PIN not set for this account", "PIN_NOT_SET", 401);
        }
      } else {
        const pinConfiguredCount = await prisma.user.count({
          where: { isActive: true, pin: { not: null } },
        });
        if (pinConfiguredCount === 0) {
          return fail("PIN not set for this account", "PIN_NOT_SET", 401);
        }
      }
    }
  }

  try {
    if (isPinLogin) {
      await signIn("credentials", {
        pin: parsed.data.pin,
        username: parsed.data.username,
        loginType: "pin",
        redirect: false,
      });
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
        isPinLogin ? "Invalid PIN" : "Invalid username or password",
        "INVALID_CREDENTIALS",
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
