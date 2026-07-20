import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/pin";

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
  const userCount = await prisma.user.count({
    where: { roleId: id, isActive: true },
  });
  if (userCount > 0) {
    throw new Error("Cannot delete role with assigned users");
  }
  return prisma.role.update({
    where: { id },
    data: { isActive: false },
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
    include: { role: true },
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
}) {
  return prisma.user.create({
    data: {
      username: input.username,
      fullName: input.fullName,
      passwordHash: await bcrypt.hash(input.password, 12),
      pin: input.pin ? hashPin(input.pin) : null,
      roleId: input.roleId,
      phone: input.phone ?? null,
      email: input.email ?? null,
    },
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
}) {
  return prisma.user.update({
    where: { id },
    data: {
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.password !== undefined ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      ...(input.pin !== undefined ? { pin: input.pin ? hashPin(input.pin) : null } : {}),
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}
export async function deleteUser(id: number) {
  return prisma.user.update({ where: { id }, data: { isActive: false } });
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
