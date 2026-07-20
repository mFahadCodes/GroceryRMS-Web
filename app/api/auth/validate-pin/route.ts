import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api/http";
import { requireSession } from "@/lib/api/rbac";
import { fail, ok } from "@/lib/api-response";
import { hashPin } from "@/lib/pin";
import { prisma } from "@/lib/prisma";
import { validatePinSchema } from "@/lib/validators/auth.validators";

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await parseJsonBody<unknown>(request);
  const parsed = validatePinSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }

  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, isActive: true },
    include: { role: true },
  });

  if (!user || !user.pin) {
    return ok({ valid: false, userId: parsed.data.userId, fullName: null, role: null });
  }

  const valid = user.pin === hashPin(parsed.data.pin);
  return ok({
    valid,
    userId: user.id,
    fullName: valid ? user.fullName : null,
    role: valid ? user.role.name : null,
  });
}
