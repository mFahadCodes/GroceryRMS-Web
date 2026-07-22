import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import Database from "better-sqlite3";
import { PERMS } from "@/lib/api/permissions";
import {
  digestManagerApprovalToken,
  generateManagerApprovalToken,
  MANAGER_APPROVAL_LIFETIME_MS,
} from "@/lib/security/manager-approval";
import type { ManagerApprovalRequester } from "@/lib/services/manager-approval-service";

export const managerApprovalMigrationPaths = [
  "prisma/migrations/20260720_000000_baseline/migration.sql",
  "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
  "prisma/migrations/20260721_000000_add_password_rotation_state/migration.sql",
  "prisma/migrations/20260722_000000_add_pin_security_state/migration.sql",
  "prisma/migrations/20260723_000000_add_manager_approval_grants/migration.sql",
  "prisma/migrations/20260724_000000_add_financial_idempotency_records/migration.sql",
  "prisma/migrations/20260725_000000_add_order_item_return_quantity/migration.sql",
];

export const MANAGER_APPROVAL_NOW = new Date("2026-07-23T12:00:00.000Z");
export const SESSION_EXPIRES_AT = new Date("2026-07-24T12:00:00.000Z");
export const REQUESTER_SESSION_ID = "mgr_approval_req_session_abcdefgh";
export const DISCOUNT_PERM = PERMS.APPLY_DISCOUNTS;
export const VOID_PERM = PERMS.VOID_ORDERS;

export function createManagerApprovalTestDatabase(name: string) {
  const databasePath = path.resolve(`.tmp/${name}.test.db`);
  const files = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  const cleanup = () => {
    for (const file of files) rmSync(file, { force: true });
  };
  cleanup();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    for (const migration of managerApprovalMigrationPaths) {
      sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
    }
  } finally {
    sqlite.close();
  }
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databasePath }),
  });
  return { client, cleanup, databasePath };
}

export function deterministicApprovalToken(seed = 1): string {
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = (seed * 17 + index * 31) & 0xff;
  }
  return generateManagerApprovalToken(() => bytes);
}

export function verifiedPinResult(
  userId: number,
  permissions: string[],
  overrides: { mustChangePassword?: boolean } = {},
) {
  return {
    status: "verified" as const,
    user: {
      id: userId,
      fullName: `Manager ${userId}`,
      roleId: userId,
      roleName: "manager",
      permissions,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  };
}

export async function seedManagerApprovalFixture(
  client: PrismaClient,
  options: {
    terminalId?: number | null;
    requesterAuthVersion?: number;
    managerAuthVersion?: number;
    requesterAccessLevel?: number;
    managerAccessLevel?: number;
    permissionName?: string;
    orderId?: number;
    selfApproval?: boolean;
  } = {},
) {
  const permissionName = options.permissionName ?? DISCOUNT_PERM;
  const requesterAccessLevel = options.requesterAccessLevel ?? 1;
  const managerAccessLevel = options.managerAccessLevel ?? 4;
  const requesterAuthVersion = options.requesterAuthVersion ?? 1;
  const managerAuthVersion = options.managerAuthVersion ?? 1;
  const terminalId = options.terminalId === undefined ? 1 : options.terminalId;
  const orderId = options.orderId ?? 50;
  const selfApproval = options.selfApproval ?? false;

  if (terminalId !== null) {
    await client.terminal.create({
      data: { id: terminalId, name: `Terminal ${terminalId}` },
    });
  }

  await client.permission.create({
    data: { id: 1, name: permissionName },
  });

  await client.role.create({
    data: { id: 1, name: "Cashier" },
  });
  await client.rolePermission.create({
    data: {
      roleId: 1,
      permissionId: 1,
      accessLevel: requesterAccessLevel,
    },
  });

  const managerRoleId = selfApproval ? 1 : 2;
  if (!selfApproval) {
    await client.role.create({
      data: { id: 2, name: "Manager" },
    });
    await client.rolePermission.create({
      data: {
        roleId: 2,
        permissionId: 1,
        accessLevel: managerAccessLevel,
      },
    });
  } else if (requesterAccessLevel < managerAccessLevel) {
    await client.rolePermission.update({
      where: {
        roleId_permissionId: { roleId: 1, permissionId: 1 },
      },
      data: { accessLevel: managerAccessLevel },
    });
  }

  const requester = await client.user.create({
    data: {
      id: 2,
      username: "requester",
      fullName: "Requester",
      passwordHash: "test-only-password-hash",
      roleId: 1,
      authVersion: requesterAuthVersion,
    },
  });

  const manager = selfApproval
    ? requester
    : await client.user.create({
        data: {
          id: 7,
          username: "manager",
          fullName: "Manager",
          passwordHash: "test-only-password-hash",
          roleId: managerRoleId,
          authVersion: managerAuthVersion,
        },
      });

  const session = await client.userSession.create({
    data: {
      sessionId: REQUESTER_SESSION_ID,
      userId: requester.id,
      terminalId,
      authVersion: requesterAuthVersion,
      expiresAt: SESSION_EXPIRES_AT,
      loginAt: MANAGER_APPROVAL_NOW,
    },
  });

  const order = await client.order.create({
    data: {
      id: orderId,
      orderNumber: `ORD-${orderId}`,
      orderType: "WalkIn",
      status: "Open",
      cashierId: requester.id,
      terminalId,
      subTotal: 10_000n,
      grandTotal: 10_000n,
    },
  });

  const requesterPermissions = [
    `${permissionName}:${Math.max(requesterAccessLevel, selfApproval ? managerAccessLevel : requesterAccessLevel)}`,
  ];
  const managerPermissions = [`${permissionName}:${managerAccessLevel}`];

  const requesterContext: ManagerApprovalRequester = {
    userId: requester.id,
    sessionId: REQUESTER_SESSION_ID,
    authVersion: requesterAuthVersion,
    terminalId,
    permissions: requesterPermissions,
  };

  return {
    requester,
    manager,
    session,
    order,
    requesterContext,
    requesterPermissions,
    managerPermissions,
  };
}

export async function insertGrant(
  client: PrismaClient,
  input: {
    token?: string;
    action?: string;
    resourceType?: string;
    resourceId: number;
    requesterUserId: number;
    requesterSessionId: number;
    requesterAuthVersion?: number;
    approverUserId: number;
    approverAuthVersion?: number;
    requiredPermission?: string;
    requiredAccessLevel?: number;
    terminalId?: number | null;
    expiresAt?: Date;
    consumedAt?: Date | null;
    revokedAt?: Date | null;
    createdAt?: Date;
  },
) {
  const token = input.token ?? deterministicApprovalToken(99);
  return client.managerApprovalGrant.create({
    data: {
      tokenHash: digestManagerApprovalToken(token),
      requesterUserId: input.requesterUserId,
      requesterSessionId: input.requesterSessionId,
      requesterAuthVersion: input.requesterAuthVersion ?? 1,
      approverUserId: input.approverUserId,
      approverAuthVersion: input.approverAuthVersion ?? 1,
      action: input.action ?? "order.discount",
      resourceType: input.resourceType ?? "order",
      resourceId: input.resourceId,
      requiredPermission: input.requiredPermission ?? DISCOUNT_PERM,
      requiredAccessLevel: input.requiredAccessLevel ?? 4,
      terminalId: input.terminalId === undefined ? 1 : input.terminalId,
      expiresAt:
        input.expiresAt ??
        new Date(MANAGER_APPROVAL_NOW.getTime() + MANAGER_APPROVAL_LIFETIME_MS),
      consumedAt: input.consumedAt ?? null,
      revokedAt: input.revokedAt ?? null,
      createdAt: input.createdAt ?? MANAGER_APPROVAL_NOW,
    },
  });
}

export async function resetManagerApprovalTables(client: PrismaClient) {
  await client.managerApprovalGrant.deleteMany();
  await client.auditLog.deleteMany();
  await client.orderItem.deleteMany();
  await client.order.deleteMany();
  await client.userSession.deleteMany();
  await client.user.deleteMany();
  await client.rolePermission.deleteMany();
  await client.permission.deleteMany();
  await client.role.deleteMany();
  await client.terminal.deleteMany();
  await client.pinThrottleState.deleteMany();
}
