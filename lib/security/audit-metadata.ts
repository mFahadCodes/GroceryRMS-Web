/**
 * Explicit safe metadata builders for high-risk security audit events.
 *
 * Callers must not pass passwords, PINs, tokens, digests, session identifiers,
 * request objects, or environment secrets. The central sanitizer still runs
 * on every write regardless of builder use.
 */

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

export type PinChangedAuditMetadata = {
  reason: string;
};

export function buildPinChangedAuditMetadata(
  reason: string,
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

export type OrderVoidAuditMetadata = {
  reason: string;
  approvedByUserId: number | null;
};

export function buildOrderVoidAuditMetadata(input: {
  reason: string;
  approvedByUserId: number | null;
}): OrderVoidAuditMetadata {
  return {
    reason: input.reason,
    approvedByUserId: input.approvedByUserId,
  };
}

export type OrderDiscountAuditMetadata = {
  discountAmount?: string;
  discountPercent?: number;
  reason?: string | null;
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
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    approvedByUserId: input.approvedByUserId,
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
