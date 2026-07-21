import { prisma } from "@/lib/prisma";
import {
  sanitizeStoredAuditJson,
  serializeSafeAuditMetadata,
} from "@/lib/security/audit-sanitizer";

type AuditInput = {
  userId?: number | null;
  action: string;
  tableName?: string | null;
  recordId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
};

type AuditStore = {
  auditLog: {
    create: (args: {
      data: {
        userId: number | null;
        action: string;
        tableName: string | null;
        recordId: number | null;
        oldValues: string | null;
        newValues: string | null;
        ipAddress: string | null;
      };
    }) => Promise<unknown>;
  };
};

function getIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return request.headers.get("x-real-ip");
}

function buildAuditData(input: AuditInput) {
  return {
    userId: input.userId ?? null,
    action: input.action,
    tableName: input.tableName ?? null,
    recordId: input.recordId ?? null,
    oldValues: serializeSafeAuditMetadata(input.oldValues),
    newValues: serializeSafeAuditMetadata(input.newValues),
    ipAddress: input.ipAddress ?? null,
  };
}

/**
 * Transactional / shared audit write boundary.
 *
 * Always sanitizes metadata immediately before Prisma persistence. Callers
 * cannot disable sanitization or mark data as pre-sanitized.
 */
export async function writeAuditRecord(
  store: AuditStore,
  input: AuditInput,
): Promise<void> {
  await store.auditLog.create({
    data: buildAuditData(input),
  });
}

/**
 * Best-effort audit writer used by ordinary route handlers.
 * Failures are swallowed so low-risk business operations are not blocked.
 */
export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await writeAuditRecord(prisma, input);
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

/**
 * Map a persisted audit row for API/report responses with defense-in-depth
 * redaction of historical metadata and safe user projection.
 */
export function mapAuditLogForResponse<T extends {
  oldValues?: string | null;
  newValues?: string | null;
  user?: unknown;
}>(row: T) {
  const { user, ...rest } = row;
  return {
    ...rest,
    oldValues: sanitizeStoredAuditJson(row.oldValues),
    newValues: sanitizeStoredAuditJson(row.newValues),
    ...(user !== undefined
      ? { user: mapAuditUserForResponse(user) }
      : {}),
  };
}

function mapAuditUserForResponse(user: unknown) {
  if (user === null || user === undefined) return null;
  if (typeof user !== "object") return null;
  const record = user as Record<string, unknown>;
  return {
    id: typeof record.id === "number" ? record.id : null,
    username: typeof record.username === "string" ? record.username : null,
    fullName: typeof record.fullName === "string" ? record.fullName : null,
  };
}
