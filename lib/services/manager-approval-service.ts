import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAuditRecord } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { buildManagerApprovalAuditMetadata } from "@/lib/security/audit-metadata";
import {
  digestManagerApprovalToken,
  generateManagerApprovalToken,
  getManagerApprovalActionConfiguration,
  isValidManagerApprovalToken,
  MANAGER_APPROVAL_CLEANUP_BATCH_SIZE,
  MANAGER_APPROVAL_CLEANUP_RETENTION_MS,
  MANAGER_APPROVAL_LIFETIME_MS,
  type ManagerApprovalAction,
} from "@/lib/security/manager-approval";
import {
  verifyUserPin,
  type PinVerificationResult,
} from "@/lib/services/pin-security-service";

export type ManagerApprovalRequester = {
  userId: number;
  sessionId: string;
  authVersion: number;
  terminalId: number | null;
  permissions: string[];
};

export type ManagerApprovalServiceCode =
  | "MANAGER_APPROVAL_FAILED"
  | "MANAGER_APPROVAL_THROTTLED"
  | "MANAGER_APPROVAL_UNAVAILABLE"
  | "MANAGER_APPROVAL_INVALID"
  | "MANAGER_APPROVAL_EXPIRED"
  | "MANAGER_APPROVAL_ALREADY_USED";

export class ManagerApprovalServiceError extends Error {
  constructor(
    public readonly code: ManagerApprovalServiceCode,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "ManagerApprovalServiceError";
  }
}

type IssueDependencies = {
  now?: Date;
  generateToken?: () => string;
  verifyPin?: (
    input: Parameters<typeof verifyUserPin>[0],
    client: PrismaClient,
  ) => Promise<PinVerificationResult>;
};

const approvalUserSelect = {
  id: true,
  isActive: true,
  authVersion: true,
  mustChangePassword: true,
  roleId: true,
  role: {
    select: {
      id: true,
      isActive: true,
      rolePermissions: {
        where: { permission: { isActive: true } },
        select: {
          accessLevel: true,
          permission: { select: { name: true, isActive: true } },
        },
      },
    },
  },
} as const;

const approvalSessionSelect = {
  id: true,
  sessionId: true,
  userId: true,
  terminalId: true,
  authVersion: true,
  isActive: true,
  expiresAt: true,
  logoutAt: true,
  revokedReason: true,
  user: { select: approvalUserSelect },
} as const;

export async function issueManagerApprovalGrant(
  input: {
    requester: ManagerApprovalRequester;
    managerUserId: number;
    managerPin: string;
    action: ManagerApprovalAction;
    resourceType: "order";
    resourceId: number;
    clientIp: string;
  },
  client: PrismaClient = prisma,
  dependencies: IssueDependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const configuration = getManagerApprovalActionConfiguration(input.action);
  if (
    !configuration ||
    configuration.resourceType !== input.resourceType ||
    !hasPermission(
      input.requester.permissions,
      configuration.requesterPermission,
      configuration.requesterAccessLevel,
    )
  ) {
    throw approvalFailure();
  }

  const requesterSession = await client.userSession.findUnique({
    where: { sessionId: input.requester.sessionId },
    select: approvalSessionSelect,
  });
  if (
    !isValidRequesterSession(
      requesterSession,
      input.requester,
      configuration.requesterPermission,
      configuration.requesterAccessLevel,
      now,
    )
  ) {
    throw approvalFailure();
  }

  const orderExists = await client.order.findUnique({
    where: { id: input.resourceId },
    select: { id: true },
  });
  if (!orderExists) {
    throw approvalFailure();
  }

  const verifyPin = dependencies.verifyPin ?? verifyUserPin;
  const verification = await verifyPin(
    {
      userId: input.managerUserId,
      pin: input.managerPin,
      clientIp: input.clientIp,
      authoritativeTerminalId: requesterSession.terminalId,
      actorUserId: input.requester.userId,
      now,
    },
    client,
  );
  if (verification.status === "throttled") {
    throw new ManagerApprovalServiceError(
      "MANAGER_APPROVAL_THROTTLED",
      429,
      verification.retryAfterSeconds,
    );
  }
  if (verification.status === "security-unavailable") {
    throw new ManagerApprovalServiceError(
      "MANAGER_APPROVAL_UNAVAILABLE",
      503,
    );
  }
  if (
    verification.status !== "verified" ||
    verification.user.id !== input.managerUserId ||
    verification.user.mustChangePassword ||
    !hasPermission(
      verification.user.permissions,
      configuration.managerPermission,
      configuration.managerAccessLevel,
    )
  ) {
    throw approvalFailure();
  }

  const rawToken =
    dependencies.generateToken?.() ?? generateManagerApprovalToken();
  if (!isValidManagerApprovalToken(rawToken)) {
    throw new ManagerApprovalServiceError(
      "MANAGER_APPROVAL_UNAVAILABLE",
      503,
    );
  }
  const tokenHash = digestManagerApprovalToken(rawToken);
  const expiresAt = new Date(now.getTime() + MANAGER_APPROVAL_LIFETIME_MS);

  await client.$transaction(async (transaction) => {
    const [currentSession, currentApprover, currentOrder] = await Promise.all([
      transaction.userSession.findUnique({
        where: { sessionId: input.requester.sessionId },
        select: approvalSessionSelect,
      }),
      transaction.user.findUnique({
        where: { id: input.managerUserId },
        select: approvalUserSelect,
      }),
      transaction.order.findUnique({
        where: { id: input.resourceId },
        select: { id: true },
      }),
    ]);

    if (
      !isValidRequesterSession(
        currentSession,
        input.requester,
        configuration.requesterPermission,
        configuration.requesterAccessLevel,
        now,
      ) ||
      !isValidApprovalUser(
        currentApprover,
        configuration.managerPermission,
        configuration.managerAccessLevel,
      ) ||
      currentApprover.id !== verification.user.id ||
      !currentOrder
    ) {
      throw approvalFailure();
    }

    await transaction.managerApprovalGrant.create({
      data: {
        tokenHash,
        requesterUserId: input.requester.userId,
        requesterSessionId: currentSession.id,
        requesterAuthVersion: currentSession.user.authVersion,
        approverUserId: currentApprover.id,
        approverAuthVersion: currentApprover.authVersion,
        action: input.action,
        resourceType: configuration.resourceType,
        resourceId: input.resourceId,
        requiredPermission: configuration.managerPermission,
        requiredAccessLevel: configuration.managerAccessLevel,
        terminalId: currentSession.terminalId,
        expiresAt,
      },
    });
    await writeAuditRecord(transaction, {
      userId: input.requester.userId,
      action: "MANAGER_APPROVAL_ISSUED",
      tableName: "orders",
      recordId: input.resourceId,
      newValues: buildManagerApprovalAuditMetadata({
        approverUserId: currentApprover.id,
        action: input.action,
        resourceType: configuration.resourceType,
        status: "issued",
      }),
    });
  });

  return {
    approvalToken: rawToken,
    action: input.action,
    resourceType: configuration.resourceType,
    resourceId: input.resourceId,
    expiresAt,
  };
}

export async function consumeManagerApprovalGrant(
  transaction: Prisma.TransactionClient,
  input: {
    requester: ManagerApprovalRequester;
    approvalToken: string;
    action: ManagerApprovalAction;
    resourceType: "order";
    resourceId: number;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const configuration = getManagerApprovalActionConfiguration(input.action);
  if (
    !configuration ||
    configuration.resourceType !== input.resourceType ||
    !isValidManagerApprovalToken(input.approvalToken)
  ) {
    throw invalidApproval();
  }

  const tokenHash = digestManagerApprovalToken(input.approvalToken);
  const grant = await transaction.managerApprovalGrant.findUnique({
    where: { tokenHash },
  });
  if (!grant) throw invalidApproval();
  if (grant.consumedAt) {
    throw new ManagerApprovalServiceError(
      "MANAGER_APPROVAL_ALREADY_USED",
      409,
    );
  }
  if (grant.expiresAt.getTime() <= now.getTime()) {
    throw new ManagerApprovalServiceError("MANAGER_APPROVAL_EXPIRED", 403);
  }
  if (grant.revokedAt) throw invalidApproval();

  if (
    grant.action !== input.action ||
    grant.resourceType !== input.resourceType ||
    grant.resourceId !== input.resourceId ||
    grant.requesterUserId !== input.requester.userId ||
    grant.requesterAuthVersion !== input.requester.authVersion ||
    grant.requiredPermission !== configuration.managerPermission ||
    grant.requiredAccessLevel !== configuration.managerAccessLevel
  ) {
    throw invalidApproval();
  }

  const [requesterSession, approver] = await Promise.all([
    transaction.userSession.findUnique({
      where: { id: grant.requesterSessionId },
      select: approvalSessionSelect,
    }),
    transaction.user.findUnique({
      where: { id: grant.approverUserId },
      select: approvalUserSelect,
    }),
  ]);
  if (
    !isValidRequesterSession(
      requesterSession,
      input.requester,
      configuration.requesterPermission,
      configuration.requesterAccessLevel,
      now,
    ) ||
    requesterSession.id !== grant.requesterSessionId ||
    requesterSession.user.authVersion !== grant.requesterAuthVersion ||
    requesterSession.terminalId !== grant.terminalId ||
    (grant.terminalId !== null &&
      input.requester.terminalId !== grant.terminalId) ||
    !isValidApprovalUser(
      approver,
      configuration.managerPermission,
      configuration.managerAccessLevel,
    ) ||
    approver.authVersion !== grant.approverAuthVersion
  ) {
    throw invalidApproval();
  }

  const consumed = await transaction.managerApprovalGrant.updateMany({
    where: {
      id: grant.id,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requesterUserId: input.requester.userId,
      requesterAuthVersion: input.requester.authVersion,
      approverUserId: approver.id,
      approverAuthVersion: approver.authVersion,
      requiredPermission: configuration.managerPermission,
      requiredAccessLevel: configuration.managerAccessLevel,
      terminalId: grant.terminalId,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      requesterSession: {
        id: grant.requesterSessionId,
        sessionId: input.requester.sessionId,
        userId: input.requester.userId,
        authVersion: input.requester.authVersion,
        terminalId: grant.terminalId,
        isActive: true,
        logoutAt: null,
        revokedReason: null,
        expiresAt: { gt: now },
        user: {
          id: input.requester.userId,
          isActive: true,
          mustChangePassword: false,
          authVersion: input.requester.authVersion,
          role: {
            isActive: true,
            rolePermissions: {
              some: {
                accessLevel: {
                  gte: configuration.requesterAccessLevel,
                },
                permission: {
                  name: configuration.requesterPermission,
                  isActive: true,
                },
              },
            },
          },
        },
      },
      approverUser: {
        id: approver.id,
        isActive: true,
        mustChangePassword: false,
        authVersion: grant.approverAuthVersion,
        role: {
          isActive: true,
          rolePermissions: {
            some: {
              accessLevel: { gte: configuration.managerAccessLevel },
              permission: {
                name: configuration.managerPermission,
                isActive: true,
              },
            },
          },
        },
      },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw invalidApproval();

  await writeAuditRecord(transaction, {
    userId: input.requester.userId,
    action: "MANAGER_APPROVAL_CONSUMED",
    tableName: "orders",
    recordId: input.resourceId,
    newValues: buildManagerApprovalAuditMetadata({
      approverUserId: approver.id,
      action: input.action,
      resourceType: input.resourceType,
      status: "consumed",
    }),
  });

  return { approverUserId: approver.id };
}

export async function cleanupManagerApprovalGrants(
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<number> {
  try {
    const cutoff = new Date(
      now.getTime() - MANAGER_APPROVAL_CLEANUP_RETENTION_MS,
    );
    const rows = await client.managerApprovalGrant.findMany({
      where: {
        OR: [
          { expiresAt: { lte: cutoff } },
          { consumedAt: { lte: cutoff } },
          { revokedAt: { lte: cutoff } },
        ],
      },
      orderBy: { expiresAt: "asc" },
      take: MANAGER_APPROVAL_CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const deleted = await client.managerApprovalGrant.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return deleted.count;
  } catch {
    return 0;
  }
}

function isValidRequesterSession(
  session:
    | {
        id: number;
        sessionId: string | null;
        userId: number;
        terminalId: number | null;
        authVersion: number | null;
        isActive: boolean;
        expiresAt: Date | null;
        logoutAt: Date | null;
        revokedReason: string | null;
        user: Prisma.UserGetPayload<{ select: typeof approvalUserSelect }>;
      }
    | null,
  requester: ManagerApprovalRequester,
  permission: string,
  accessLevel: number,
  now: Date,
): session is NonNullable<typeof session> {
  return Boolean(
    session &&
      session.sessionId === requester.sessionId &&
      session.userId === requester.userId &&
      session.user.id === requester.userId &&
      session.isActive &&
      session.logoutAt === null &&
      session.revokedReason === null &&
      session.expiresAt &&
      session.expiresAt.getTime() > now.getTime() &&
      session.user.isActive &&
      !session.user.mustChangePassword &&
      session.user.role.isActive &&
      session.user.role.id === session.user.roleId &&
      session.user.authVersion === requester.authVersion &&
      session.authVersion === session.user.authVersion &&
      session.terminalId === requester.terminalId &&
      hasMappedPermission(session.user, permission, accessLevel),
  );
}

function isValidApprovalUser(
  user: Prisma.UserGetPayload<{ select: typeof approvalUserSelect }> | null,
  permission: string,
  accessLevel: number,
): user is NonNullable<typeof user> {
  return Boolean(
    user &&
      user.isActive &&
      !user.mustChangePassword &&
      user.role.isActive &&
      user.role.id === user.roleId &&
      hasMappedPermission(user, permission, accessLevel),
  );
}

function hasMappedPermission(
  user: Prisma.UserGetPayload<{ select: typeof approvalUserSelect }>,
  permission: string,
  accessLevel: number,
) {
  const target = permission.toLowerCase();
  return user.role.rolePermissions.some(
    (row) =>
      row.permission.isActive &&
      row.permission.name.toLowerCase() === target &&
      row.accessLevel >= accessLevel,
  );
}

function approvalFailure() {
  return new ManagerApprovalServiceError("MANAGER_APPROVAL_FAILED", 403);
}

function invalidApproval() {
  return new ManagerApprovalServiceError("MANAGER_APPROVAL_INVALID", 403);
}
