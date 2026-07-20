import { checkPermission, hasPermission } from "@/lib/permissions";
import { hashPin } from "@/lib/pin";
import { prisma } from "@/lib/prisma";

export type ManagerApprovalResult =
  | { ok: true; approvedByUserId: number }
  | { ok: false; code: "MANAGER_PIN_REQUIRED" | "INVALID_MANAGER_PIN" };

export async function resolveManagerApproval(input: {
  userId: number;
  permissions: string[];
  permissionName: string;
  minimumLevel: number;
  managerPin?: string;
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

  const pin = input.managerPin?.trim();
  if (!pin) {
    return { ok: false, code: "MANAGER_PIN_REQUIRED" };
  }

  const pinHash = hashPin(pin);
  const candidates = await prisma.user.findMany({
    where: { pin: pinHash, isActive: true },
    select: { id: true },
  });

  for (const candidate of candidates) {
    const allowed = await checkPermission(
      candidate.id,
      input.permissionName,
      input.minimumLevel,
    );
    if (allowed) {
      return { ok: true, approvedByUserId: candidate.id };
    }
  }

  return { ok: false, code: "INVALID_MANAGER_PIN" };
}
