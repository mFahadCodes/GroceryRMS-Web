import { hasPermission } from "@/lib/permissions";
import { verifyUserPin } from "@/lib/services/pin-security-service";

export type ManagerApprovalResult =
  | { ok: true; approvedByUserId: number }
  | {
      ok: false;
      code:
        | "MANAGER_PIN_REQUIRED"
        | "INVALID_MANAGER_PIN"
        | "MANAGER_PIN_THROTTLED"
        | "PIN_SECURITY_UNAVAILABLE";
      retryAfterSeconds?: number;
    };

export async function resolveManagerApproval(input: {
  userId: number;
  permissions: string[];
  permissionName: string;
  minimumLevel: number;
  managerUserId?: number;
  managerPin?: string;
  clientIp: string;
}): Promise<ManagerApprovalResult> {
  if (
    hasPermission(
      input.permissions,
      input.permissionName,
      input.minimumLevel,
    )
  ) {
    return { ok: true, approvedByUserId: input.userId };
  }

  if (!input.managerUserId || !input.managerPin) {
    return { ok: false, code: "MANAGER_PIN_REQUIRED" };
  }
  const result = await verifyUserPin({
    userId: input.managerUserId,
    pin: input.managerPin,
    clientIp: input.clientIp,
    actorUserId: input.userId,
  });
  if (result.status === "throttled") {
    return {
      ok: false,
      code: "MANAGER_PIN_THROTTLED",
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  if (result.status === "security-unavailable") {
    return { ok: false, code: "PIN_SECURITY_UNAVAILABLE" };
  }
  if (
    result.status !== "verified" ||
    result.user.mustChangePassword ||
    !hasPermission(
      result.user.permissions,
      input.permissionName,
      input.minimumLevel,
    )
  ) {
    return { ok: false, code: "INVALID_MANAGER_PIN" };
  }
  return { ok: true, approvedByUserId: result.user.id };
}
