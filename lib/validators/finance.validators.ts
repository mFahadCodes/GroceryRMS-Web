import { z } from "zod";
import { paisaSchema, phoneSchema } from "./common";

export const expenseCategorySchema = z.enum([
  "Utilities",
  "Payroll",
  "Inventory",
  "Maintenance",
  "Other",
]);

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const createExpenseSchema = z.object({
  supplierId: z.number().int().positive().optional().nullable(),
  description: z.string().min(1),
  amount: paisaSchema,
  expenseDate: z.string().datetime().optional(),
  invoiceNumber: z.string().optional().nullable(),
  category: expenseCategorySchema.optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
