/**
 * SEC-05B central audit-event policy registry.
 *
 * Every audit event the application may emit is registered here with exactly
 * one audit mode. Callers never choose or override the mode, the entity
 * table, or the result-state vocabulary; the controlled wrappers in
 * `lib/audit.ts` read this registry and fail closed on unknown actions.
 *
 * Modes:
 *
 * - TRANSACTION_REQUIRED — the audit record is part of the security or
 *   financial integrity guarantee. The audit write must share the protected
 *   mutation's Prisma transaction: audit failure rolls the mutation back and
 *   a success audit can never survive a rolled-back mutation.
 * - BEST_EFFORT — low-risk operational metadata. Audit persistence failure
 *   must never block the underlying approved operation, and no raw metadata
 *   may be emitted on failure.
 * - ACCESS_ACTIVITY — read/export/print activity. Never mutates business
 *   state and never runs inside a mutation transaction; failure must not
 *   change response data or authorization.
 *
 * This registry is static and deterministic. It contains identifiers only —
 * never secrets, credentials, or free text.
 */

export type AuditMode =
  | "TRANSACTION_REQUIRED"
  | "BEST_EFFORT"
  | "ACCESS_ACTIVITY";

/**
 * Narrow result-state vocabulary. Events encode their result through the
 * registered action name plus categorical metadata (for example the manager
 * approval `status` field); arbitrary caller-supplied result strings are not
 * accepted anywhere.
 */
export type AuditResultState =
  | "succeeded"
  | "failed"
  | "denied"
  | "revoked"
  | "expired";

export type AuditEventDefinition = {
  readonly mode: AuditMode;
  /** Entity table recorded on the row. Callers cannot override it. */
  readonly entityTable: string | null;
  /** When true the wrapper rejects a missing authenticated actor. */
  readonly requiresActor: boolean;
  /** When true the wrapper rejects a missing entity record id. */
  readonly requiresEntityId: boolean;
  /** Result states this event is allowed to represent. */
  readonly allowedResults: readonly AuditResultState[];
};

const SUCCEEDED = ["succeeded"] as const;

function required(
  entityTable: string,
  options: {
    requiresActor?: boolean;
    requiresEntityId?: boolean;
    allowedResults?: readonly AuditResultState[];
  } = {},
): {
  readonly mode: "TRANSACTION_REQUIRED";
  readonly entityTable: string;
  readonly requiresActor: boolean;
  readonly requiresEntityId: boolean;
  readonly allowedResults: readonly AuditResultState[];
} {
  return {
    mode: "TRANSACTION_REQUIRED",
    entityTable,
    requiresActor: options.requiresActor ?? true,
    requiresEntityId: options.requiresEntityId ?? true,
    allowedResults: options.allowedResults ?? SUCCEEDED,
  };
}

function bestEffort(entityTable: string | null): {
  readonly mode: "BEST_EFFORT";
  readonly entityTable: string | null;
  readonly requiresActor: false;
  readonly requiresEntityId: false;
  readonly allowedResults: readonly ["succeeded"];
} {
  return {
    mode: "BEST_EFFORT",
    entityTable,
    requiresActor: false,
    requiresEntityId: false,
    allowedResults: SUCCEEDED,
  };
}

function access(entityTable: string | null): {
  readonly mode: "ACCESS_ACTIVITY";
  readonly entityTable: string | null;
  readonly requiresActor: false;
  readonly requiresEntityId: false;
  readonly allowedResults: readonly ["succeeded"];
} {
  return {
    mode: "ACCESS_ACTIVITY",
    entityTable,
    requiresActor: false,
    requiresEntityId: false,
    allowedResults: SUCCEEDED,
  };
}

/**
 * Central audit event registry. Action names are stable; existing persisted
 * action strings are preserved for report compatibility (including the
 * historical `SHIFT_CLOSE` / `CLOSE_SHIFT` pair, which are distinct routes).
 */
export const AUDIT_EVENTS = {
  // --- Credential and PIN lifecycle (security-sensitive) -----------------
  PASSWORD_CHANGED: required("users"),
  PIN_CHANGED: required("users", { requiresActor: false }),
  PIN_HASH_UPGRADED: required("users", { requiresActor: false }),
  PIN_LOCKOUT_RESET: required("users"),
  PIN_VERIFICATION_SUCCEEDED: required("users", { requiresActor: false }),
  PIN_VERIFICATION_FAILED: required("users", {
    requiresActor: false,
    requiresEntityId: false,
    allowedResults: ["failed"],
  }),
  PIN_VERIFICATION_THROTTLED: required("users", {
    requiresActor: false,
    requiresEntityId: false,
    allowedResults: ["denied"],
  }),

  // --- Session and account administration --------------------------------
  FORCE_LOGOUT: required("user_sessions", {
    allowedResults: ["succeeded", "revoked"],
  }),
  CREATE_USER: required("users"),
  UPDATE_USER: required("users"),
  DELETE_USER: required("users"),
  REPLACE_ROLE_PERMISSIONS: required("role_permissions"),

  // --- Manager approval grants -------------------------------------------
  MANAGER_APPROVAL_ISSUED: required("orders"),
  MANAGER_APPROVAL_CONSUMED: required("orders"),

  // --- Financial order actions -------------------------------------------
  VOID_ORDER: required("orders", { requiresActor: false }),
  APPLY_ORDER_DISCOUNT: required("orders", { requiresActor: false }),
  CHECKOUT: required("orders"),
  PARTIAL_PAYMENT: required("orders"),
  REFUND_ORDER: required("orders"),
  RETURN: required("orders"),

  // --- Configuration -------------------------------------------------------
  // requiresActor is false because system maintenance (for example the
  // LastBackupAt marker) legitimately writes settings with a null actor.
  UPSERT_SETTING: required("app_settings", { requiresActor: false }),

  // --- Inventory integrity -------------------------------------------------
  RECEIVE_PURCHASE_ORDER: required("purchase_orders", {
    requiresActor: false,
  }),
  APPLY_STOCK_TAKE: required("stock_takes", { requiresActor: false }),

  // --- Access / read / export activity ------------------------------------
  PRINT_RECEIPT: access("orders"),
  OPEN_DRAWER: access("cash_drawer_logs"),
  DB_BACKUP: access("database"),

  // --- Best-effort operational metadata ------------------------------------
  ADD_CUSTOMER_ADDRESS: bestEffort("customer_addresses"),
  ADD_ORDER_ITEM: bestEffort("order_items"),
  ADJUST_LOYALTY: bestEffort("customers"),
  APPLY_ORDER_TAX: bestEffort("orders"),
  CASH_DRAWER_ENTRY: bestEffort("cash_drawer_logs"),
  CLOSE_SHIFT: bestEffort("shifts"),
  CREATE_CATEGORY: bestEffort("product_categories"),
  CREATE_CUSTOMER: bestEffort("customers"),
  CREATE_DISCOUNT: bestEffort("discounts"),
  CREATE_EMPLOYEE: bestEffort("employees"),
  CREATE_EXPENSE: bestEffort("expenses"),
  CREATE_ORDER: bestEffort("orders"),
  CREATE_PAYMENT_METHOD: bestEffort("payment_methods"),
  CREATE_PRINTER: bestEffort("printers"),
  CREATE_PRODUCT: bestEffort("products"),
  CREATE_PRODUCT_VARIANT: bestEffort("product_variants"),
  CREATE_PROMOTION: bestEffort("promotion_bundles"),
  CREATE_PURCHASE_ORDER: bestEffort("purchase_orders"),
  CREATE_ROLE: bestEffort("roles"),
  CREATE_STOCK_MOVEMENT: bestEffort("stock_movements"),
  CREATE_STOCK_TAKE: bestEffort("stock_takes"),
  CREATE_SUPPLIER: bestEffort("suppliers"),
  CREATE_TAX_RATE: bestEffort("tax_rates"),
  CREATE_TERMINAL: bestEffort("terminals"),
  DB_RESTORE: bestEffort("database"),
  DB_RESTORE_FROM_LIST: bestEffort("database"),
  DELETE_CATEGORY: bestEffort("product_categories"),
  DELETE_CUSTOMER: bestEffort("customers"),
  DELETE_CUSTOMER_ADDRESS: bestEffort("customer_addresses"),
  DELETE_DISCOUNT: bestEffort("discounts"),
  DELETE_EMPLOYEE: bestEffort("employees"),
  DELETE_EXPENSE: bestEffort("expenses"),
  DELETE_ORDER_ITEM: bestEffort("order_items"),
  DELETE_PAYMENT_METHOD: bestEffort("payment_methods"),
  DELETE_PRINTER: bestEffort("printers"),
  DELETE_PRODUCT: bestEffort("products"),
  DELETE_PRODUCT_VARIANT: bestEffort("product_variants"),
  DELETE_PROMOTION: bestEffort("promotion_bundles"),
  DELETE_ROLE: bestEffort("roles"),
  DELETE_SUPPLIER: bestEffort("suppliers"),
  DELETE_TAX_RATE: bestEffort("tax_rates"),
  DELETE_TERMINAL: bestEffort("terminals"),
  DELIVERED: bestEffort("orders"),
  DISPATCH: bestEffort("orders"),
  EXPIRE_LOYALTY_POINTS: bestEffort("loyalty_transactions"),
  GENERATE_PAYROLL: bestEffort("payroll"),
  HOLD_ORDER: bestEffort("orders"),
  MERGE_CATEGORY: bestEffort("product_categories"),
  OPEN_SHIFT: bestEffort("shifts"),
  PATCH_ORDER_ITEM: bestEffort("order_items"),
  PAY_EXPENSE: bestEffort("expenses"),
  PAY_PAYROLL: bestEffort("payroll"),
  RECALL_ORDER: bestEffort("orders"),
  SET_DEFAULT_TAX_RATE: bestEffort("app_settings"),
  SHIFT_CLOSE: bestEffort("shifts"),
  UPDATE_CATEGORY: bestEffort("product_categories"),
  UPDATE_CUSTOMER: bestEffort("customers"),
  UPDATE_CUSTOMER_ADDRESS: bestEffort("customer_addresses"),
  UPDATE_DISCOUNT: bestEffort("discounts"),
  UPDATE_EMPLOYEE: bestEffort("employees"),
  UPDATE_EXPENSE: bestEffort("expenses"),
  UPDATE_ORDER_ADJUSTMENT: bestEffort("orders"),
  UPDATE_ORDER_ITEM: bestEffort("order_items"),
  UPDATE_ORDER_META: bestEffort("orders"),
  UPDATE_ORDER_NOTES: bestEffort("orders"),
  UPDATE_PAYMENT_METHOD: bestEffort("payment_methods"),
  UPDATE_PAYROLL: bestEffort("payroll"),
  UPDATE_PRINTER: bestEffort("printers"),
  UPDATE_PRODUCT: bestEffort("products"),
  UPDATE_PRODUCT_VARIANT: bestEffort("product_variants"),
  UPDATE_PROMOTION: bestEffort("promotion_bundles"),
  UPDATE_SUPPLIER: bestEffort("suppliers"),
  UPDATE_TAX_RATE: bestEffort("tax_rates"),
  UPDATE_TERMINAL: bestEffort("terminals"),
  UPLOAD_CATEGORY_IMAGE: bestEffort("product_categories"),
  UPLOAD_PRODUCT_IMAGE: bestEffort("products"),
  VOID_ORDER_ITEM: bestEffort("order_items"),
} as const satisfies Record<string, AuditEventDefinition>;

export type RegisteredAuditAction = keyof typeof AUDIT_EVENTS;

type ActionsWithMode<M extends AuditMode> = {
  [A in RegisteredAuditAction]: (typeof AUDIT_EVENTS)[A]["mode"] extends M
    ? A
    : never;
}[RegisteredAuditAction];

export type TransactionRequiredAuditAction =
  ActionsWithMode<"TRANSACTION_REQUIRED">;
export type BestEffortAuditAction = ActionsWithMode<"BEST_EFFORT">;
export type AccessActivityAuditAction = ActionsWithMode<"ACCESS_ACTIVITY">;

/** Thrown when audit policy is violated. Never contains caller metadata. */
export class AuditPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditPolicyError";
  }
}

export function isRegisteredAuditAction(
  action: string,
): action is RegisteredAuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_EVENTS, action);
}

/**
 * Look up the policy for an action. Unknown actions fail closed everywhere —
 * production callers cannot invent arbitrary action strings.
 */
export function getAuditEventDefinition(
  action: string,
): AuditEventDefinition {
  if (!isRegisteredAuditAction(action)) {
    throw new AuditPolicyError(
      `Audit action "${action}" is not registered in the audit policy`,
    );
  }
  return AUDIT_EVENTS[action];
}
