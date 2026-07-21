import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { writeRequiredAudit } from "@/lib/audit";
import { buildPasswordChangedAuditMetadata } from "@/lib/security/audit-metadata";
import { SESSION_REVOCATION_REASONS } from "../security/auth-constants";
import { validatePasswordPolicy } from "../security/password-policy";

export type PasswordChangeErrorCode =
  | "CURRENT_PASSWORD_INVALID"
  | "PASSWORD_POLICY_VIOLATION"
  | "PASSWORD_REUSE_NOT_ALLOWED";

export class PasswordChangeError extends Error {
  constructor(public readonly code: PasswordChangeErrorCode) {
    super(
      code === "CURRENT_PASSWORD_INVALID"
        ? "Current password is invalid"
        : code === "PASSWORD_REUSE_NOT_ALLOWED"
          ? "New password must differ from the current password"
          : "New password does not satisfy the password policy",
    );
    this.name = "PasswordChangeError";
  }
}

export async function changeOwnPassword(
  client: PrismaClient,
  input: {
    userId: number;
    currentPassword: string;
    newPassword: string;
    now?: Date;
    ipAddress?: string | null;
  },
  dependencies: {
    compare(password: string, hash: string): Promise<boolean>;
    hash(password: string, cost: number): Promise<string>;
  } = bcrypt,
) {
  const user = await client.user.findFirst({
    where: { id: input.userId, isActive: true },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      authVersion: true,
    },
  });
  if (
    !user?.passwordHash ||
    !(await dependencies.compare(input.currentPassword, user.passwordHash))
  ) {
    throw new PasswordChangeError("CURRENT_PASSWORD_INVALID");
  }

  const policy = validatePasswordPolicy(input.newPassword, user.username);
  if (!policy.ok) {
    throw new PasswordChangeError("PASSWORD_POLICY_VIOLATION");
  }
  if (await dependencies.compare(input.newPassword, user.passwordHash)) {
    throw new PasswordChangeError("PASSWORD_REUSE_NOT_ALLOWED");
  }

  const passwordHash = await dependencies.hash(policy.value, 12);
  const now = input.now ?? new Date();

  return client.$transaction(async (transaction) => {
    const updated = await transaction.user.updateMany({
      where: {
        id: user.id,
        isActive: true,
        passwordHash: user.passwordHash,
        authVersion: user.authVersion,
      },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: now,
        authVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new PasswordChangeError("CURRENT_PASSWORD_INVALID");
    }

    await transaction.userSession.updateMany({
      where: { userId: user.id, isActive: true, logoutAt: null },
      data: {
        isActive: false,
        logoutAt: now,
        revokedReason: SESSION_REVOCATION_REASONS.PASSWORD_CHANGE,
      },
    });
    await writeRequiredAudit(transaction, {
      userId: user.id,
      action: "PASSWORD_CHANGED",
      recordId: user.id,
      newValues: buildPasswordChangedAuditMetadata(),
      ipAddress: input.ipAddress ?? null,
    });

    return {
      passwordChanged: true as const,
      reauthenticationRequired: true as const,
    };
  });
}
