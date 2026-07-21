import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAuditRecord } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { buildPinChangedAuditMetadata } from "@/lib/security/audit-metadata";
import {
  deriveThrottleKey,
  hashPinV2,
  hashLegacyPinV2,
  isLegacyPinHash,
  isV2PinHash,
  performDummyPinVerification,
  validatePinFormat,
  verifyLegacyPinHash,
  verifyV2PinHash,
} from "@/lib/security/pin-hash";
import {
  PIN_SECURITY_POLICY,
  PinSecurityConfigurationError,
} from "@/lib/security/pin-security-config";

type PinClient = PrismaClient;
type PinTransaction = Prisma.TransactionClient;

export type PinVerificationResult =
  | {
      status: "verified";
      user: {
        id: number;
        fullName: string;
        roleId: number;
        roleName: string;
        permissions: string[];
        mustChangePassword: boolean;
      };
    }
  | { status: "failed" }
  | { status: "throttled"; retryAfterSeconds: number }
  | { status: "security-unavailable" };

export interface VerifyPinInput {
  userId: number;
  pin: string;
  clientIp: string;
  authoritativeTerminalId?: number | null;
  actorUserId?: number | null;
  now?: Date;
}

const safeUserSelect = {
  id: true,
  fullName: true,
  isActive: true,
  pin: true,
  pinFailedAttempts: true,
  pinLastFailedAt: true,
  pinLockedUntil: true,
  mustChangePassword: true,
  roleId: true,
  role: {
    select: {
      name: true,
      isActive: true,
      rolePermissions: {
        where: { permission: { isActive: true } },
        select: {
          accessLevel: true,
          permission: { select: { name: true } },
        },
      },
    },
  },
} as const;

export async function createSecurePinHash(
  userId: number,
  pin: string,
): Promise<string> {
  return hashPinV2(userId, pin);
}

export async function verifyUserPin(
  input: VerifyPinInput,
  client: PinClient = prisma,
): Promise<PinVerificationResult> {
  const now = input.now ?? new Date();
  let buckets: Array<{ scope: "IP" | "TERMINAL"; keyHash: string }>;
  try {
    buckets = [
      { scope: "IP", keyHash: deriveThrottleKey("IP", input.clientIp) },
      ...(input.authoritativeTerminalId
        ? [
            {
              scope: "TERMINAL" as const,
              keyHash: deriveThrottleKey(
                "TERMINAL",
                String(input.authoritativeTerminalId),
              ),
            },
          ]
        : []),
    ];
  } catch (error) {
    if (error instanceof PinSecurityConfigurationError) {
      return { status: "security-unavailable" };
    }
    return { status: "security-unavailable" };
  }

  await cleanupExpiredBuckets(client, now);

  try {
    const [user, activeBucket] = await Promise.all([
      client.user.findUnique({ where: { id: input.userId }, select: safeUserSelect }),
      client.pinThrottleState.findFirst({
        where: {
          OR: buckets.map((bucket) => ({
            scope: bucket.scope,
            keyHash: bucket.keyHash,
          })),
          lockedUntil: { gt: now },
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);

    const userLockActive = Boolean(
      user?.isActive &&
        user.pinLockedUntil &&
        user.pinLockedUntil.getTime() > now.getTime() &&
        !hasFailureStateDecayed(user.pinLastFailedAt, now),
    );
    if (activeBucket || userLockActive) {
      await writeAudit(client, {
        actorUserId: input.actorUserId,
        targetUserId: user?.id,
        action: "PIN_VERIFICATION_THROTTLED",
        reason: "throttled",
      });
      return throttledResult();
    }

    if (!user?.isActive || !user.role.isActive) {
      await performDummyPinVerification(input.userId, input.pin);
      return recordFailedAttempt(client, input, buckets, null, now);
    }

    let verified = false;
    let legacy = false;
    if (isV2PinHash(user.pin)) {
      verified = await verifyV2PinHash(user.id, input.pin, user.pin);
    } else if (isLegacyPinHash(user.pin)) {
      verified = verifyLegacyPinHash(input.pin, user.pin);
      legacy = verified;
      await performDummyPinVerification(user.id, input.pin);
    } else {
      await performDummyPinVerification(user.id, input.pin);
    }

    if (!validatePinFormat(input.pin) || !verified) {
      return recordFailedAttempt(client, input, buckets, user.id, now);
    }

    const migratedHash = legacy
      ? await hashLegacyPinV2(user.id, input.pin)
      : undefined;

    return await client.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: {
          id: user.id,
          isActive: true,
          pin: user.pin,
          role: { isActive: true },
        },
        data: {
          ...(migratedHash ? { pin: migratedHash } : {}),
          pinFailedAttempts: 0,
          pinLastFailedAt: null,
          pinLockedUntil: null,
        },
      });
      if (updated.count !== 1) return { status: "failed" } as const;

      if (legacy) {
        await writeAudit(transaction, {
          actorUserId: input.actorUserId,
          targetUserId: user.id,
          action: "PIN_HASH_UPGRADED",
          reason: "legacy-migrated",
        });
      }
      await writeAudit(transaction, {
        actorUserId: input.actorUserId,
        targetUserId: user.id,
        action: "PIN_VERIFICATION_SUCCEEDED",
        reason: "verified",
      });

      const current = await transaction.user.findUniqueOrThrow({
        where: { id: user.id },
        select: safeUserSelect,
      });
      return {
        status: "verified" as const,
        user: {
          id: current.id,
          fullName: current.fullName,
          roleId: current.roleId,
          roleName: current.role.name,
          mustChangePassword: current.mustChangePassword,
          permissions: current.role.isActive
            ? current.role.rolePermissions.map(
                (row) => `${row.permission.name}:${row.accessLevel}`,
              )
            : [],
        },
      };
    });
  } catch {
    return { status: "security-unavailable" };
  }
}

export async function resetUserPinLockout(
  input: { userId: number; actorUserId: number; now?: Date },
  client: PinClient = prisma,
): Promise<{ reset: boolean }> {
  return client.$transaction(async (transaction) => {
    const result = await transaction.user.updateMany({
      where: { id: input.userId },
      data: {
        pinFailedAttempts: 0,
        pinLastFailedAt: null,
        pinLockedUntil: null,
      },
    });
    await writeAudit(transaction, {
      actorUserId: input.actorUserId,
      targetUserId: input.userId,
      action: "PIN_LOCKOUT_RESET",
      reason: "administrator-reset",
    });
    return { reset: result.count === 1 };
  });
}

async function recordFailedAttempt(
  client: PinClient,
  input: VerifyPinInput,
  buckets: Array<{ scope: "IP" | "TERMINAL"; keyHash: string }>,
  targetUserId: number | null,
  now: Date,
): Promise<PinVerificationResult> {
  try {
    return await client.$transaction(async (transaction) => {
      let userThrottled = false;
      if (targetUserId) {
        const decayBefore = new Date(
          now.getTime() - PIN_SECURITY_POLICY.userFailureDecayMs,
        );
        await transaction.user.updateMany({
          where: { id: targetUserId, pinLastFailedAt: { lt: decayBefore } },
          data: {
            pinFailedAttempts: 0,
            pinLastFailedAt: null,
            pinLockedUntil: null,
          },
        });
        const failed = await transaction.user.update({
          where: { id: targetUserId },
          data: {
            pinFailedAttempts: { increment: 1 },
            pinLastFailedAt: now,
          },
          select: { pinFailedAttempts: true },
        });
        const lockMs = userLockDurationMs(failed.pinFailedAttempts);
        if (lockMs > 0) {
          userThrottled = true;
          await transaction.user.update({
            where: { id: targetUserId },
            data: { pinLockedUntil: new Date(now.getTime() + lockMs) },
          });
        }
      }

      let aggregateThrottled = false;
      for (const bucket of buckets) {
        const state = await incrementBucket(transaction, bucket, now);
        aggregateThrottled ||= state;
      }

      await writeAudit(transaction, {
        actorUserId: input.actorUserId,
        targetUserId: targetUserId ?? undefined,
        action:
          userThrottled || aggregateThrottled
            ? "PIN_VERIFICATION_THROTTLED"
            : "PIN_VERIFICATION_FAILED",
        reason:
          userThrottled || aggregateThrottled ? "throttled" : "failed",
      });

      return userThrottled || aggregateThrottled
        ? throttledResult()
        : ({ status: "failed" } as const);
    });
  } catch {
    return { status: "security-unavailable" };
  }
}

async function incrementBucket(
  transaction: PinTransaction,
  bucket: { scope: "IP" | "TERMINAL"; keyHash: string },
  now: Date,
): Promise<boolean> {
  const windowCutoff = new Date(
    now.getTime() - PIN_SECURITY_POLICY.aggregateWindowMs,
  );
  await transaction.pinThrottleState.updateMany({
    where: {
      scope: bucket.scope,
      keyHash: bucket.keyHash,
      windowStartedAt: { lt: windowCutoff },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: {
      failedAttempts: 0,
      windowStartedAt: now,
      lockedUntil: null,
    },
  });

  const state = await transaction.pinThrottleState.upsert({
    where: {
      scope_keyHash: { scope: bucket.scope, keyHash: bucket.keyHash },
    },
    create: {
      scope: bucket.scope,
      keyHash: bucket.keyHash,
      failedAttempts: 1,
      windowStartedAt: now,
      expiresAt: new Date(
        now.getTime() + PIN_SECURITY_POLICY.aggregateRecordTtlMs,
      ),
    },
    update: {
      failedAttempts: { increment: 1 },
      expiresAt: new Date(
        now.getTime() + PIN_SECURITY_POLICY.aggregateRecordTtlMs,
      ),
    },
    select: { id: true, failedAttempts: true, lockedUntil: true },
  });
  const threshold =
    bucket.scope === "IP"
      ? PIN_SECURITY_POLICY.ipFailureThreshold
      : PIN_SECURITY_POLICY.terminalFailureThreshold;
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    return true;
  }
  if (state.failedAttempts < threshold) return false;

  await transaction.pinThrottleState.update({
    where: { id: state.id },
    data: {
      lockedUntil: new Date(now.getTime() + PIN_SECURITY_POLICY.aggregateLockMs),
      expiresAt: new Date(
        now.getTime() + PIN_SECURITY_POLICY.aggregateRecordTtlMs,
      ),
    },
  });
  return true;
}

async function cleanupExpiredBuckets(client: PinClient, now: Date) {
  try {
    const expired = await client.pinThrottleState.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: PIN_SECURITY_POLICY.cleanupBatchSize,
      select: { id: true },
    });
    if (expired.length > 0) {
      await client.pinThrottleState.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      });
    }
  } catch {
    // Cleanup is bounded maintenance; verification still checks live locks.
  }
}

function hasFailureStateDecayed(lastFailedAt: Date | null, now: Date) {
  return (
    !lastFailedAt ||
    now.getTime() - lastFailedAt.getTime() >=
      PIN_SECURITY_POLICY.userFailureDecayMs
  );
}

function userLockDurationMs(failureCount: number): number {
  if (failureCount >= 11) return 30 * 60 * 1000;
  if (failureCount === 9) return 15 * 60 * 1000;
  if (failureCount === 7) return 5 * 60 * 1000;
  if (failureCount === 5) return 60 * 1000;
  return 0;
}

function throttledResult(): PinVerificationResult {
  return {
    status: "throttled",
    retryAfterSeconds: PIN_SECURITY_POLICY.safeRetryAfterSeconds,
  };
}

async function writeAudit(
  store: Pick<PinClient, "auditLog"> | Pick<PinTransaction, "auditLog">,
  input: {
    actorUserId?: number | null;
    targetUserId?: number;
    action: string;
    reason: string;
  },
) {
  await writeAuditRecord(store, {
    userId: input.actorUserId ?? null,
    action: input.action,
    tableName: "users",
    recordId: input.targetUserId ?? null,
    newValues: buildPinChangedAuditMetadata(input.reason),
  });
}
