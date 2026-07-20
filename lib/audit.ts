import { prisma } from "@/lib/prisma";

type AuditInput = {
  userId?: number | null;
  action: string;
  tableName?: string | null;
  recordId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
};

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    );
  } catch {
    return null;
  }
}

function getIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return request.headers.get("x-real-ip");
}

export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        tableName: input.tableName ?? null,
        recordId: input.recordId ?? null,
        oldValues: toJson(input.oldValues),
        newValues: toJson(input.newValues),
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch {
    // Never block business flow if audit logging fails.
  }
}

export async function auditFromRequest(
  request: Request,
  input: Omit<AuditInput, "ipAddress">,
): Promise<void> {
  await auditLog({
    ...input,
    ipAddress: getIpAddress(request),
  });
}
