import { createHash, randomBytes } from "node:crypto";
import { PERMS } from "@/lib/api/permissions";

export const MANAGER_APPROVAL_TOKEN_BYTES = 32;
export const MANAGER_APPROVAL_LIFETIME_MS = 120_000;
export const MANAGER_APPROVAL_CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MANAGER_APPROVAL_CLEANUP_BATCH_SIZE = 100;

export const MANAGER_APPROVAL_ACTIONS = [
  "order.discount",
  "order.void",
] as const;

export type ManagerApprovalAction =
  (typeof MANAGER_APPROVAL_ACTIONS)[number];

type ActionConfiguration = {
  resourceType: "order";
  requesterPermission: string;
  requesterAccessLevel: number;
  managerPermission: string;
  managerAccessLevel: number;
};

export const MANAGER_APPROVAL_ACTION_MAP: Record<
  ManagerApprovalAction,
  ActionConfiguration
> = {
  "order.discount": {
    resourceType: "order",
    requesterPermission: PERMS.APPLY_DISCOUNTS,
    requesterAccessLevel: 1,
    managerPermission: PERMS.APPLY_DISCOUNTS,
    managerAccessLevel: 4,
  },
  "order.void": {
    resourceType: "order",
    requesterPermission: PERMS.VOID_ORDERS,
    requesterAccessLevel: 1,
    managerPermission: PERMS.VOID_ORDERS,
    managerAccessLevel: 5,
  },
};

const APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isManagerApprovalAction(
  value: string,
): value is ManagerApprovalAction {
  return Object.prototype.hasOwnProperty.call(
    MANAGER_APPROVAL_ACTION_MAP,
    value,
  );
}

export function getManagerApprovalActionConfiguration(
  action: string,
): ActionConfiguration | null {
  return isManagerApprovalAction(action)
    ? MANAGER_APPROVAL_ACTION_MAP[action]
    : null;
}

export function generateManagerApprovalToken(
  random: (size: number) => Buffer = randomBytes,
): string {
  return random(MANAGER_APPROVAL_TOKEN_BYTES).toString("base64url");
}

export function isValidManagerApprovalToken(token: unknown): token is string {
  return typeof token === "string" && APPROVAL_TOKEN_PATTERN.test(token);
}

export function digestManagerApprovalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
