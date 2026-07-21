import { prisma } from "@/lib/prisma";
import {
  sanitizeStoredAuditJson,
  serializeSafeAuditMetadata,
} from "@/lib/security/audit-sanitizer";
import {
  AuditPolicyError,
  getAuditEventDefinition,
  type AccessActivityAuditAction,
  type BestEffortAuditAction,
  type TransactionRequiredAuditAction,
} from "@/lib/security/audit-policy";
import type {
  InventoryApplyAuditMetadata,
  ManagerApprovalAuditMetadata,
  OrderCheckoutAuditMetadata,
  OrderDiscountAuditMetadata,
  OrderPartialPaymentAuditMetadata,
  OrderRefundAuditMetadata,
  OrderReturnAuditMetadata,
  OrderVoidAuditMetadata,
  PasswordChangedAuditMetadata,
  PinChangedAuditMetadata,
  RolePermissionsAuditMetadata,
  SessionForceLogoutAuditMetadata,
  SettingUpsertAuditMetadata,
  UserAccountAuditMetadata,
} from "@/lib/security/audit-metadata";

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

type AuditWriteInput = {
  userId?: number | null;
  action: string;
  recordId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
};

/**
 * Internal persistence boundary. Not exported: all writes must go through
 * the mode-specific wrappers below, which enforce the SEC-05B audit policy
 * registry. Metadata is always sanitized immediately before persistence;
 * callers cannot disable sanitization or mark data as pre-sanitized.
 */
async function writeAuditRecord(
  store: AuditStore,
  input: AuditWriteInput,
  entityTable: string | null,
): Promise<void> {
  await store.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      tableName: entityTable,
      recordId: input.recordId ?? null,
      oldValues: serializeSafeAuditMetadata(input.oldValues),
      newValues: serializeSafeAuditMetadata(input.newValues),
      ipAddress: input.ipAddress ?? null,
    },
  });
}

function enforceIdentityRequirements(
  action: string,
  input: AuditWriteInput,
): void {
  const definition = getAuditEventDefinition(action);
  if (
    definition.requiresActor &&
    (input.userId === null || input.userId === undefined)
  ) {
    throw new AuditPolicyError(
      `Audit event "${action}" requires an authenticated actor`,
    );
  }
  if (
    definition.requiresEntityId &&
    (input.recordId === null || input.recordId === undefined)
  ) {
    throw new AuditPolicyError(
      `Audit event "${action}" requires an entity record id`,
    );
  }
}

/**
 * Metadata contracts for transaction-required events. Each event accepts
 * only its registered builder output — arbitrary objects, `parsed.data`,
 * requests, and full domain entities do not type-check.
 */
type RequiredAuditMetadataMap = {
  PASSWORD_CHANGED: PasswordChangedAuditMetadata;
  PIN_CHANGED: PinChangedAuditMetadata;
  PIN_HASH_UPGRADED: PinChangedAuditMetadata;
  PIN_LOCKOUT_RESET: PinChangedAuditMetadata;
  PIN_VERIFICATION_SUCCEEDED: PinChangedAuditMetadata;
  PIN_VERIFICATION_FAILED: PinChangedAuditMetadata;
  PIN_VERIFICATION_THROTTLED: PinChangedAuditMetadata;
  FORCE_LOGOUT: SessionForceLogoutAuditMetadata;
  CREATE_USER: UserAccountAuditMetadata;
  UPDATE_USER: UserAccountAuditMetadata;
  DELETE_USER: UserAccountAuditMetadata;
  REPLACE_ROLE_PERMISSIONS: RolePermissionsAuditMetadata;
  MANAGER_APPROVAL_ISSUED: ManagerApprovalAuditMetadata;
  MANAGER_APPROVAL_CONSUMED: ManagerApprovalAuditMetadata;
  VOID_ORDER: OrderVoidAuditMetadata;
  APPLY_ORDER_DISCOUNT: OrderDiscountAuditMetadata;
  CHECKOUT: OrderCheckoutAuditMetadata;
  PARTIAL_PAYMENT: OrderPartialPaymentAuditMetadata;
  REFUND_ORDER: OrderRefundAuditMetadata;
  RETURN: OrderReturnAuditMetadata;
  UPSERT_SETTING: SettingUpsertAuditMetadata;
  RECEIVE_PURCHASE_ORDER: InventoryApplyAuditMetadata;
  APPLY_STOCK_TAKE: InventoryApplyAuditMetadata;
};

// Compile-time check: the metadata map covers exactly the registered
// transaction-required actions.
type AssertExactRequiredMap = [
  Exclude<TransactionRequiredAuditAction, keyof RequiredAuditMetadataMap>,
  Exclude<keyof RequiredAuditMetadataMap, TransactionRequiredAuditAction>,
] extends [never, never]
  ? true
  : never;
const requiredMapCoversRegistry: AssertExactRequiredMap = true;
void requiredMapCoversRegistry;

export type RequiredAuditInput<
  A extends TransactionRequiredAuditAction = TransactionRequiredAuditAction,
> = {
  action: A;
  userId?: number | null;
  recordId?: number | null;
  newValues: RequiredAuditMetadataMap[A];
  ipAddress?: string | null;
};

/**
 * Transactionally required audit write.
 *
 * Must be called with the Prisma transaction client of the protected
 * mutation. The root Prisma client is rejected so the audit record cannot be
 * committed independently of the mutation. Persistence failures propagate
 * and roll the whole transaction back; they are never caught here.
 */
export async function writeRequiredAudit<
  A extends TransactionRequiredAuditAction,
>(transaction: AuditStore, input: RequiredAuditInput<A>): Promise<void> {
  const definition = getAuditEventDefinition(input.action);
  if (definition.mode !== "TRANSACTION_REQUIRED") {
    throw new AuditPolicyError(
      `Audit event "${input.action}" is not transaction-required`,
    );
  }
  // Root PrismaClient exposes $connect; interactive transaction clients from
  // driver adapters still expose $transaction, so $connect is the reliable
  // discriminator that rejects unaudited root-client writes.
  if (typeof (transaction as { $connect?: unknown }).$connect === "function") {
    throw new AuditPolicyError(
      `Required audit "${input.action}" must use the mutation's transaction client, not a root Prisma client`,
    );
  }
  enforceIdentityRequirements(input.action, input);
  await writeAuditRecord(transaction, input, definition.entityTable);
}

export type BestEffortAuditInput = {
  action: BestEffortAuditAction;
  userId?: number | null;
  recordId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  /**
   * Ignored. Entity table is owned by the audit policy registry; callers
   * cannot override it. Accepted only so existing route literals continue
   * to type-check while being migrated off caller-supplied tables.
   */
  tableName?: string | null;
};

/**
 * Best-effort audit write for approved low-risk operations. Persistence
 * failures are swallowed so the underlying operation is never blocked; raw
 * metadata is never logged on failure. Policy violations (unknown action,
 * wrong mode) still fail closed because they are developer errors, not
 * runtime storage failures.
 */
export async function writeBestEffortAudit(
  input: BestEffortAuditInput,
): Promise<void> {
  const definition = getAuditEventDefinition(input.action);
  if (definition.mode !== "BEST_EFFORT") {
    throw new AuditPolicyError(
      `Audit event "${input.action}" is not best-effort; use its registered wrapper`,
    );
  }
  enforceIdentityRequirements(input.action, input);
  try {
    await writeAuditRecord(prisma, input, definition.entityTable);
  } catch {
    // Never block business flow if audit logging fails. No raw metadata is
    // emitted here by design.
  }
}

/**
 * Best-effort audit with request-derived IP context. This is the standard
 * route-handler entry point for registered best-effort events.
 */
export async function auditFromRequest(
  request: Request,
  input: Omit<BestEffortAuditInput, "ipAddress">,
): Promise<void> {
  await writeBestEffortAudit({
    ...input,
    ipAddress: getIpAddress(request),
  });
}

export type AccessAuditInput = {
  action: AccessActivityAuditAction;
  userId?: number | null;
  recordId?: number | null;
  newValues?: unknown;
  ipAddress?: string | null;
  /** Ignored. Entity table is owned by the audit policy registry. */
  tableName?: string | null;
};

/**
 * Access/read activity audit. Non-mutating by policy: it never receives a
 * transaction client, never blocks the response when audit storage is
 * unavailable, and must not be used for security or financial mutations.
 */
export async function writeAccessAudit(
  input: AccessAuditInput,
): Promise<void> {
  const definition = getAuditEventDefinition(input.action);
  if (definition.mode !== "ACCESS_ACTIVITY") {
    throw new AuditPolicyError(
      `Audit event "${input.action}" is not access activity`,
    );
  }
  enforceIdentityRequirements(input.action, input);
  try {
    await writeAuditRecord(prisma, input, definition.entityTable);
  } catch {
    // Access auditing must never change response data or authorization.
  }
}

/**
 * Access-activity audit with request-derived IP context.
 */
export async function accessAuditFromRequest(
  request: Request,
  input: Omit<AccessAuditInput, "ipAddress">,
): Promise<void> {
  await writeAccessAudit({
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
