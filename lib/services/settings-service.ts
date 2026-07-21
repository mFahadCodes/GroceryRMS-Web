import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SESSION_REVOCATION_REASONS } from "@/lib/security/auth-constants";
import {
  invalidateUserAuthentication,
  invalidateUsersForRoleChange,
} from "@/lib/security/session-invalidation";
import { createSecurePinHash } from "@/lib/services/pin-security-service";
import { validatePinCreationPolicy } from "@/lib/security/pin-hash";
import { ServiceError } from "@/lib/api/service-error";
import { PinSecurityConfigurationError } from "@/lib/security/pin-security-config";

const safeManagedUserSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  isActive: true,
  username: true,
  fullName: true,
  roleId: true,
  phone: true,
  email: true,
  lastLoginAt: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  role: { select: { id: true, name: true } },
} as const;

export async function getAllSettingsGrouped() {
  const rows = await prisma.appSetting.findMany({
    where: { isActive: true },
    orderBy: [{ group: "asc" }, { key: "asc" }],
  });
  return rows.reduce<Record<string, typeof rows>>((acc, row) => {
    const key = row.group ?? "General";
    acc[key] = acc[key] ?? [];
    acc[key].push(row);
    return acc;
  }, {});
}

export async function getSettingByKey(key: string) {
  return prisma.appSetting.findUnique({ where: { key } });
}

export async function upsertSetting(
  key: string,
  input: { value: string; dataType?: string | null; description?: string | null; group?: string | null },
) {
  return prisma.appSetting.upsert({
    where: { key },
    update: {
      value: input.value,
      dataType: input.dataType ?? null,
      description: input.description ?? null,
      group: input.group ?? null,
      isActive: true,
    },
    create: {
      key,
      value: input.value,
      dataType: input.dataType ?? "string",
      description: input.description ?? null,
      group: input.group ?? "General",
    },
  });
}

export async function getPublicStoreSettings() {
  const keys = [
    "StoreName",
    "StoreAddress",
    "StorePhone",
    "Currency",
    "CurrencySymbol",
    "ReceiptHeader",
    "ReceiptFooter",
  ];
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys }, isActive: true },
  });
  const byKey = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  return {
    name: byKey.StoreName ?? "My Store",
    address: byKey.StoreAddress ?? "",
    phone: byKey.StorePhone ?? "",
    currency: byKey.Currency ?? "PKR",
    currencySymbol: byKey.CurrencySymbol ?? "Rs.",
    receiptHeader: byKey.ReceiptHeader ?? "",
    receiptFooter: byKey.ReceiptFooter ?? "",
  };
}

export async function listTaxRates() {
  return prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
}
export async function createTaxRate(input: { name: string; rate: string | number; isInclusive?: boolean }) {
  return prisma.taxRate.create({ data: { name: input.name, rate: input.rate, isInclusive: input.isInclusive ?? false } });
}
export async function updateTaxRate(id: number, input: { name?: string; rate?: string | number; isInclusive?: boolean }) {
  return prisma.taxRate.update({ where: { id }, data: input });
}
export async function deleteTaxRate(id: number) {
  return prisma.taxRate.update({ where: { id }, data: { isActive: false } });
}

export async function listPaymentMethods() {
  return prisma.paymentMethod.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
}
export async function createPaymentMethod(input: { name: string; code?: string | null; isDigital?: boolean }) {
  return prisma.paymentMethod.create({ data: { name: input.name, code: input.code ?? null, isDigital: input.isDigital ?? false } });
}
export async function updatePaymentMethod(id: number, input: { name?: string; code?: string | null; isDigital?: boolean }) {
  return prisma.paymentMethod.update({ where: { id }, data: input });
}
export async function deletePaymentMethod(id: number) {
  return prisma.paymentMethod.update({ where: { id }, data: { isActive: false } });
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    where: { isActive: true },
    include: { _count: { select: { rolePermissions: true } } },
    orderBy: { name: "asc" },
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissionCount: role._count.rolePermissions,
  }));
}

export async function createRole(input: { name: string; description?: string | null }) {
  return prisma.role.create({
    data: {
      name: input.name,
      description: input.description ?? null,
    },
  });
}

export async function deleteRole(id: number) {
  return prisma.$transaction(async (transaction) => {
    const userCount = await transaction.user.count({
      where: { roleId: id, isActive: true },
    });
    if (userCount > 0) {
      throw new Error("Cannot delete role with assigned users");
    }
    const role = await transaction.role.update({
      where: { id },
      data: { isActive: false },
    });
    await invalidateUsersForRoleChange(transaction, {
      roleId: id,
      reason: SESSION_REVOCATION_REASONS.ROLE_CHANGE,
    });
    return role;
  });
}

export async function getUserById(id: number) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    roleId: user.roleId,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    role: {
      id: user.role.id,
      name: user.role.name,
      permissions: user.role.rolePermissions.map((row) => ({
        id: row.permission.id,
        name: row.permission.name,
        accessLevel: row.accessLevel,
      })),
    },
  };
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: safeManagedUserSelect,
    orderBy: { username: "asc" },
  });
}
export async function createUser(input: {
  username: string;
  fullName: string;
  password: string;
  pin?: string | null;
  roleId: number;
  phone?: string | null;
  email?: string | null;
}, securityContext?: { actorUserId: number }, client: typeof prisma = prisma) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  if (input.pin) assertPinCreationAllowed(input.pin);
  return client.$transaction(async (transaction) => {
    const created = await transaction.user.create({
      data: {
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      pin: null,
      roleId: input.roleId,
      phone: input.phone ?? null,
      email: input.email ?? null,
      },
      select: { id: true },
    });
    if (input.pin) {
      const pinHash = await securePinHashOrThrow(created.id, input.pin);
      await transaction.user.update({
        where: { id: created.id },
        data: { pin: pinHash },
      });
      await transaction.auditLog.create({
        data: {
          userId: securityContext?.actorUserId ?? null,
          action: "PIN_CHANGED",
          tableName: "users",
          recordId: created.id,
          newValues: JSON.stringify({ reason: "administrator-assigned" }),
        },
      });
    }
    return transaction.user.findUniqueOrThrow({
      where: { id: created.id },
      select: safeManagedUserSelect,
    });
  });
}
export async function updateUser(id: number, input: {
  username?: string;
  fullName?: string;
  password?: string;
  pin?: string | null;
  roleId?: number;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
}, securityContext?: { actorUserId: number }, client: typeof prisma = prisma) {
  const passwordHash =
    input.password !== undefined
      ? await bcrypt.hash(input.password, 12)
      : undefined;
  if (input.pin) assertPinCreationAllowed(input.pin);
  const pinHash =
    input.pin !== undefined
      ? input.pin
        ? await securePinHashOrThrow(id, input.pin)
        : null
      : undefined;
  const data = {
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
    ...(passwordHash !== undefined ? { passwordHash } : {}),
    ...(pinHash !== undefined ? { pin: pinHash } : {}),
    ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  const revocationReason =
    input.password !== undefined || input.pin !== undefined
      ? SESSION_REVOCATION_REASONS.CREDENTIAL_CHANGE
      : input.roleId !== undefined
        ? SESSION_REVOCATION_REASONS.ROLE_CHANGE
        : input.isActive !== undefined
          ? SESSION_REVOCATION_REASONS.ACCOUNT_STATUS_CHANGE
          : null;

  if (!revocationReason) {
    return client.user.update({
      where: { id },
      data,
      select: safeManagedUserSelect,
    });
  }

  return client.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id }, data });
    await invalidateUserAuthentication(transaction, {
      userId: id,
      reason: revocationReason,
    });
    if (input.pin !== undefined) {
      await transaction.auditLog.create({
        data: {
          userId: securityContext?.actorUserId ?? null,
          action: "PIN_CHANGED",
          tableName: "users",
          recordId: id,
          newValues: JSON.stringify({
            reason: input.pin ? "administrator-changed" : "administrator-removed",
          }),
        },
      });
    }
    return transaction.user.findUniqueOrThrow({
      where: { id },
      select: safeManagedUserSelect,
    });
  });
}
export async function deleteUser(id: number) {
  return prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id },
      data: { isActive: false },
    });
    await invalidateUserAuthentication(transaction, {
      userId: id,
      reason: SESSION_REVOCATION_REASONS.ACCOUNT_STATUS_CHANGE,
    });
    return transaction.user.findUniqueOrThrow({
      where: { id },
      select: safeManagedUserSelect,
    });
  });
}

function assertPinCreationAllowed(pin: string) {
  const result = validatePinCreationPolicy(pin);
  if (!result.ok) {
    throw new ServiceError(result.message, result.code, 400);
  }
}

async function securePinHashOrThrow(userId: number, pin: string) {
  try {
    return await createSecurePinHash(userId, pin);
  } catch (error) {
    if (error instanceof PinSecurityConfigurationError) {
      throw new ServiceError(
        "PIN security is unavailable",
        error.code,
        503,
      );
    }
    throw error;
  }
}

export async function replaceRolePermissions(
  roleId: number,
  permissions: Array<{ permissionId: number; accessLevel: number }>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((row) => ({ roleId, permissionId: row.permissionId, accessLevel: row.accessLevel })),
      });
    }
    await invalidateUsersForRoleChange(tx, {
      roleId,
      reason: SESSION_REVOCATION_REASONS.ROLE_PERMISSIONS_CHANGE,
    });
    return tx.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
  });
}

export async function listPrinters() {
  return prisma.printer.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
}
export async function createPrinter(input: {
  name: string;
  type: "Receipt" | "Label" | "Report";
  connectionType: "USB" | "Network" | "Bluetooth" | "Serial";
  address?: string | null;
  paperWidth?: number;
  isDefault?: boolean;
  systemPrinterName?: string | null;
}) {
  return prisma.printer.create({
    data: {
      name: input.name,
      type: input.type,
      connectionType: input.connectionType,
      address: input.address ?? null,
      paperWidth: input.paperWidth ?? 80,
      isDefault: input.isDefault ?? false,
      systemPrinterName: input.systemPrinterName ?? null,
    },
  });
}
export async function updatePrinter(id: number, input: Partial<{
  name: string;
  type: "Receipt" | "Label" | "Report";
  connectionType: "USB" | "Network" | "Bluetooth" | "Serial";
  address: string | null;
  paperWidth: number;
  isDefault: boolean;
  systemPrinterName: string | null;
}>) {
  return prisma.printer.update({ where: { id }, data: input });
}
export async function deletePrinter(id: number) {
  return prisma.printer.update({ where: { id }, data: { isActive: false } });
}

export async function listTerminals() {
  return prisma.terminal.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
}
export async function createTerminal(input: { name: string; location?: string | null; machineId?: string | null }) {
  return prisma.terminal.create({ data: { name: input.name, location: input.location ?? null, machineId: input.machineId ?? null } });
}
export async function updateTerminal(id: number, input: { name?: string; location?: string | null; machineId?: string | null }) {
  return prisma.terminal.update({ where: { id }, data: input });
}
export async function deleteTerminal(id: number) {
  return prisma.terminal.update({ where: { id }, data: { isActive: false } });
}
