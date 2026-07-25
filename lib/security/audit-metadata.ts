/**
 * Explicit safe metadata builders for registered audit events.
 *
 * Callers must not pass passwords, PINs, tokens, digests, session identifiers,
 * request objects, full domain entities, or environment secrets. The central
 * sanitizer still runs on every write regardless of builder use.
 *
 * SEC-05B free-text policy: user-entered free text (void/discount/refund
 * reasons, notes, descriptions) is never stored verbatim in high-risk audit
 * metadata because short credentials typed into it cannot be detected
 * reliably. Builders record only presence and bounded length; the business
 * record keeps the actual text where the domain model already stores it.
 */

export type FreeTextAuditSummary = {
  reasonProvided: boolean;
  reasonLength: number;
};

/**
 * Summarize user-entered free text without persisting it. Only presence and
 * bounded length are recorded.
 */
export function summarizeFreeTextReason(
  reason: string | null | undefined,
): FreeTextAuditSummary {
  const text = typeof reason === "string" ? reason.trim() : "";
  return {
    reasonProvided: text.length > 0,
    reasonLength: Math.min(text.length, 10_000),
  };
}

export type PasswordChangedAuditMetadata = {
  success: true;
  reauthenticationRequired: true;
};

export function buildPasswordChangedAuditMetadata(): PasswordChangedAuditMetadata {
  return {
    success: true,
    reauthenticationRequired: true,
  };
}

/**
 * Categorical, system-generated PIN event reasons. This is not free text;
 * user-entered content is never accepted here.
 */
export type PinAuditReason =
  | "administrator-assigned"
  | "administrator-changed"
  | "administrator-removed"
  | "administrator-reset"
  | "legacy-migrated"
  | "verified"
  | "failed"
  | "throttled";

export type PinChangedAuditMetadata = {
  reason: PinAuditReason;
};

export function buildPinChangedAuditMetadata(
  reason: PinAuditReason,
): PinChangedAuditMetadata {
  return { reason };
}

export type ManagerApprovalAuditMetadata = {
  approverUserId: number;
  action: string;
  resourceType: string;
  status: "issued" | "consumed";
};

export function buildManagerApprovalAuditMetadata(input: {
  approverUserId: number;
  action: string;
  resourceType: string;
  status: "issued" | "consumed";
}): ManagerApprovalAuditMetadata {
  return {
    approverUserId: input.approverUserId,
    action: input.action,
    resourceType: input.resourceType,
    status: input.status,
  };
}

export type SessionForceLogoutAuditMetadata = {
  userId: number;
  username: string;
};

export function buildSessionForceLogoutAuditMetadata(input: {
  userId: number;
  username: string;
}): SessionForceLogoutAuditMetadata {
  return {
    userId: input.userId,
    username: input.username,
  };
}

export type OrderVoidAuditMetadata = FreeTextAuditSummary & {
  approvedByUserId: number | null;
  stockReversed: boolean;
};

export function buildOrderVoidAuditMetadata(input: {
  reason: string | null | undefined;
  approvedByUserId: number | null;
  stockReversed: boolean;
}): OrderVoidAuditMetadata {
  return {
    ...summarizeFreeTextReason(input.reason),
    approvedByUserId: input.approvedByUserId,
    stockReversed: input.stockReversed,
  };
}

export type OrderDiscountAuditMetadata = FreeTextAuditSummary & {
  discountAmount?: string;
  discountPercent?: number;
  approvedByUserId: number | null;
};

export function buildOrderDiscountAuditMetadata(input: {
  discountAmount?: bigint;
  discountPercent?: number;
  reason?: string | null;
  approvedByUserId: number | null;
}): OrderDiscountAuditMetadata {
  return {
    ...(input.discountAmount !== undefined
      ? { discountAmount: input.discountAmount.toString() }
      : {}),
    ...(input.discountPercent !== undefined
      ? { discountPercent: input.discountPercent }
      : {}),
    ...summarizeFreeTextReason(input.reason),
    approvedByUserId: input.approvedByUserId,
  };
}

export type OrderTaxApplyAuditMetadata = {
  orderId: number;
  taxRateId: number;
  priorTaxAmount: string;
  newTaxAmount: string;
  priorGrandTotal: string;
  newGrandTotal: string;
};

export function buildOrderTaxApplyAuditMetadata(input: {
  orderId: number;
  taxRateId: number;
  priorTaxAmount: bigint;
  newTaxAmount: bigint;
  priorGrandTotal: bigint;
  newGrandTotal: bigint;
}): OrderTaxApplyAuditMetadata {
  return {
    orderId: input.orderId,
    taxRateId: input.taxRateId,
    priorTaxAmount: input.priorTaxAmount.toString(),
    newTaxAmount: input.newTaxAmount.toString(),
    priorGrandTotal: input.priorGrandTotal.toString(),
    newGrandTotal: input.newGrandTotal.toString(),
  };
}

export type OrderAdjustmentAuditMetadata = {
  adjustment: string;
  priorGrandTotal: string;
  newGrandTotal: string;
};

export function buildOrderAdjustmentAuditMetadata(input: {
  adjustment: bigint;
  priorGrandTotal: bigint;
  newGrandTotal: bigint;
}): OrderAdjustmentAuditMetadata {
  return {
    adjustment: input.adjustment.toString(),
    priorGrandTotal: input.priorGrandTotal.toString(),
    newGrandTotal: input.newGrandTotal.toString(),
  };
}

export type OrderCheckoutAuditMetadata = {
  terminalId: number;
  paymentCount: number;
  paymentMethodIds: number[];
  grandTotal: string;
};

export function buildOrderCheckoutAuditMetadata(input: {
  terminalId: number;
  paymentMethodIds: number[];
  grandTotal: bigint;
}): OrderCheckoutAuditMetadata {
  return {
    terminalId: input.terminalId,
    paymentCount: input.paymentMethodIds.length,
    paymentMethodIds: [...input.paymentMethodIds],
    grandTotal: input.grandTotal.toString(),
  };
}

export type OrderPartialPaymentAuditMetadata = {
  paymentMethodId: number;
  amount: string;
  fullyPaid: boolean;
};

export function buildOrderPartialPaymentAuditMetadata(input: {
  paymentMethodId: number;
  amount: bigint;
  fullyPaid: boolean;
}): OrderPartialPaymentAuditMetadata {
  return {
    paymentMethodId: input.paymentMethodId,
    amount: input.amount.toString(),
    fullyPaid: input.fullyPaid,
  };
}

export type OrderRefundAuditMetadata = FreeTextAuditSummary & {
  amount: string;
  paymentMethodId: number;
  refundOrderId: number;
};

export function buildOrderRefundAuditMetadata(input: {
  amount: bigint;
  paymentMethodId: number;
  reason: string | null | undefined;
  refundOrderId: number;
}): OrderRefundAuditMetadata {
  return {
    ...summarizeFreeTextReason(input.reason),
    amount: input.amount.toString(),
    paymentMethodId: input.paymentMethodId,
    refundOrderId: input.refundOrderId,
  };
}

export type OrderReturnAuditMetadata = {
  itemCount: number;
  refundAmount: string;
  refundOrderId: number;
};

export function buildOrderReturnAuditMetadata(input: {
  itemCount: number;
  refundAmount: bigint;
  refundOrderId: number;
}): OrderReturnAuditMetadata {
  return {
    itemCount: input.itemCount,
    refundAmount: input.refundAmount.toString(),
    refundOrderId: input.refundOrderId,
  };
}

export type UserAccountAuditMetadata = {
  username?: string;
  roleId?: number;
  fieldsChanged: string[];
  passwordChanged: boolean;
  pinChanged: boolean;
  isActive?: boolean;
};

/**
 * Field names only — never field values. Credential changes are recorded as
 * booleans.
 */
export function buildUserAccountAuditMetadata(input: {
  username?: string;
  roleId?: number;
  fieldsChanged: string[];
  passwordChanged?: boolean;
  pinChanged?: boolean;
  isActive?: boolean;
}): UserAccountAuditMetadata {
  return {
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
    fieldsChanged: [...input.fieldsChanged],
    passwordChanged: input.passwordChanged ?? false,
    pinChanged: input.pinChanged ?? false,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
}

export type RolePermissionsAuditMetadata = {
  roleId: number;
  permissionCount: number;
  permissions: Array<{ permissionId: number; accessLevel: number }>;
};

export function buildRolePermissionsAuditMetadata(input: {
  roleId: number;
  permissions: Array<{ permissionId: number; accessLevel: number }>;
}): RolePermissionsAuditMetadata {
  return {
    roleId: input.roleId,
    permissionCount: input.permissions.length,
    permissions: input.permissions.map((row) => ({
      permissionId: row.permissionId,
      accessLevel: row.accessLevel,
    })),
  };
}

export type SettingUpsertAuditMetadata = {
  settingKey: string;
  dataType: string;
  valuePresent: boolean;
};

/**
 * Settings values may hold API keys / peppers / opaque secrets. Audit only
 * identifiers and presence — never the raw setting value.
 */
export function buildSettingUpsertAuditMetadata(input: {
  settingKey: string;
  dataType: string;
  value: unknown;
}): SettingUpsertAuditMetadata {
  return {
    settingKey: input.settingKey,
    dataType: input.dataType,
    valuePresent: input.value !== undefined && input.value !== null && input.value !== "",
  };
}

export type InventoryApplyAuditMetadata = {
  itemCount: number;
};

export function buildInventoryApplyAuditMetadata(input: {
  itemCount: number;
}): InventoryApplyAuditMetadata {
  return { itemCount: input.itemCount };
}

// --- Best-effort order metadata builders (SEC-04A generic route et al.) ---

export type OrderItemAddedAuditMetadata = {
  productId: number | null;
  variantId: number | null;
  quantity: number;
  weightProvided: boolean;
  notesProvided: boolean;
  scannedBarcodeProvided: boolean;
};

export function buildOrderItemAddedAuditMetadata(input: {
  productId?: number | null;
  variantId?: number | null;
  quantity: number;
  weightKg?: string | number | null;
  notes?: string | null;
  scannedBarcode?: string | null;
}): OrderItemAddedAuditMetadata {
  return {
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    quantity: input.quantity,
    weightProvided: input.weightKg !== undefined && input.weightKg !== null,
    notesProvided: typeof input.notes === "string" && input.notes.length > 0,
    scannedBarcodeProvided:
      typeof input.scannedBarcode === "string" &&
      input.scannedBarcode.length > 0,
  };
}

export type OrderItemQuantityAuditMetadata = {
  orderItemId: number;
  quantity: number | null;
};

export function buildOrderItemQuantityAuditMetadata(input: {
  orderItemId: number;
  quantity?: number | null;
}): OrderItemQuantityAuditMetadata {
  return {
    orderItemId: input.orderItemId,
    quantity: input.quantity ?? null,
  };
}

export type OrderItemPatchAuditMetadata = OrderItemQuantityAuditMetadata &
  FreeTextAuditSummary;

export function buildOrderItemPatchAuditMetadata(input: {
  orderItemId: number;
  quantity?: number | null;
  voidReason?: string | null;
}): OrderItemPatchAuditMetadata {
  return {
    ...buildOrderItemQuantityAuditMetadata(input),
    ...summarizeFreeTextReason(input.voidReason),
  };
}

export type OrderItemVoidAuditMetadata = FreeTextAuditSummary & {
  orderItemId: number;
};

export function buildOrderItemVoidAuditMetadata(input: {
  orderItemId: number;
  voidReason?: string | null;
}): OrderItemVoidAuditMetadata {
  return {
    ...summarizeFreeTextReason(input.voidReason),
    orderItemId: input.orderItemId,
  };
}

export type OrderMetadataUpdateAuditMetadata = {
  notesProvided: boolean;
  customerId: number | null;
};

export function buildOrderMetadataUpdateAuditMetadata(input: {
  notes?: string | null;
  customerId?: number | null;
}): OrderMetadataUpdateAuditMetadata {
  return {
    notesProvided: typeof input.notes === "string" && input.notes.length > 0,
    customerId: input.customerId ?? null,
  };
}

export type CashDrawerEntryAuditMetadata = {
  type: "PayIn" | "PayOut";
  amount: string;
  descriptionProvided: boolean;
  orderId: number | null;
};

export function buildCashDrawerEntryAuditMetadata(input: {
  type: "PayIn" | "PayOut";
  amount: bigint;
  description?: string | null;
  orderId?: number | null;
}): CashDrawerEntryAuditMetadata {
  return {
    type: input.type,
    amount: input.amount.toString(),
    descriptionProvided:
      typeof input.description === "string" && input.description.length > 0,
    orderId: input.orderId ?? null,
  };
}

export type ShiftAuditMetadata = {
  terminalId?: number | null;
  balance: string;
  notesProvided: boolean;
};

export function buildShiftAuditMetadata(input: {
  terminalId?: number | null;
  balance: bigint;
  notes?: string | null;
}): ShiftAuditMetadata {
  return {
    ...(input.terminalId !== undefined
      ? { terminalId: input.terminalId }
      : {}),
    balance: input.balance.toString(),
    notesProvided: typeof input.notes === "string" && input.notes.length > 0,
  };
}

/**
 * Transaction-required shift-close metadata. Free-text notes stay on the
 * shift record; audit metadata records only presence/length plus the safe
 * numeric totals that the close mutation itself persists.
 */
export type ShiftCloseAuditMetadata = FreeTextAuditSummary & {
  closingBalance: string;
  expectedBalance: string;
  discrepancy: string;
  terminalId: number | null;
};

export function buildShiftCloseAuditMetadata(input: {
  closingBalance: bigint;
  expectedBalance: bigint;
  discrepancy: bigint;
  terminalId: number | null;
  notes?: string | null;
}): ShiftCloseAuditMetadata {
  return {
    ...summarizeFreeTextReason(input.notes),
    closingBalance: input.closingBalance.toString(),
    expectedBalance: input.expectedBalance.toString(),
    discrepancy: input.discrepancy.toString(),
    terminalId: input.terminalId,
  };
}
