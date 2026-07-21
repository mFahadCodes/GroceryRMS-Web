import { z } from "zod";
import { decimalSchema } from "./common";

export const printerTypeSchema = z.enum(["Receipt", "Label", "Report"]);
export const connectionTypeSchema = z.enum([
  "USB",
  "Network",
  "Bluetooth",
  "Serial",
]);

export const upsertSettingSchema = z.object({
  value: z.string().min(1),
  dataType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  group: z.string().optional().nullable(),
});

export const createTaxRateSchema = z.object({
  name: z.string().min(1),
  rate: decimalSchema,
  isInclusive: z.boolean().optional().default(false),
});

export const updateTaxRateSchema = createTaxRateSchema.partial();

export const createPaymentMethodSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  isDigital: z.boolean().optional().default(false),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial();

export const createTerminalSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional().nullable(),
  machineId: z.string().optional().nullable(),
});

export const updateTerminalSchema = createTerminalSchema.partial();

export const createPrinterSchema = z.object({
  name: z.string().min(1),
  type: printerTypeSchema,
  connectionType: connectionTypeSchema,
  address: z.string().optional().nullable(),
  paperWidth: z.number().int().positive().optional().default(80),
  isDefault: z.boolean().optional().default(false),
  systemPrinterName: z.string().optional().nullable(),
});

export const updatePrinterSchema = createPrinterSchema.partial();

export const createUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(1),
  pin: z.string().regex(/^[0-9]{4}$/).optional().nullable(),
  roleId: z.number().int().positive(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
}).strict();

export const updateUserSchema = z.object({
  username: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  pin: z.string().regex(/^[0-9]{4}$/).optional().nullable(),
  roleId: z.number().int().positive().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional(),
}).strict();

export const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

export const updateRoleSchema = createRoleSchema.partial();

export const rolePermissionEntrySchema = z.object({
  permissionId: z.number().int().positive(),
  accessLevel: z.number().int().min(1).max(5),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionEntrySchema),
});

export type UpsertSettingInput = z.infer<typeof upsertSettingSchema>;
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type CreateTerminalInput = z.infer<typeof createTerminalSchema>;
export type UpdateTerminalInput = z.infer<typeof updateTerminalSchema>;
export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateRolePermissionsInput = z.infer<
  typeof updateRolePermissionsSchema
>;
