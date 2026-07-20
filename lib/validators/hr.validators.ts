import { z } from "zod";
import { cnicSchema, paisaSchema, phoneSchema } from "./common";

export const employeeCategorySchema = z.enum([
  "Floor",
  "Cashier",
  "Delivery",
  "Management",
  "Warehouse",
  "Other",
]);

export const employmentTypeSchema = z.enum([
  "FullTime",
  "PartTime",
  "Contract",
  "Daily",
]);

export const createEmployeeSchema = z.object({
  name: z.string().min(1),
  phone: phoneSchema.optional().nullable(),
  email: z.string().email().optional().nullable(),
  cnic: cnicSchema.optional().nullable(),
  address: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  category: employeeCategorySchema.optional().default("Floor"),
  employmentType: employmentTypeSchema,
  designation: z.string().optional().nullable(),
  joiningDate: z.string().datetime().optional(),
  leavingDate: z.string().datetime().optional().nullable(),
  basicSalary: paisaSchema.optional(),
  allowances: paisaSchema.optional(),
  deductions: paisaSchema.optional(),
  userId: z.number().int().positive().optional().nullable(),
});

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ employmentType: true })
  .partial()
  .extend({
    employmentType: employmentTypeSchema.optional(),
  });

export const payrollGenerateSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  employeeIds: z.array(z.number().int().positive()).optional(),
});

export const payrollUpdateSchema = z.object({
  bonus: paisaSchema.optional(),
  advance: paisaSchema.optional(),
  notes: z.string().optional().nullable(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type PayrollGenerateInput = z.infer<typeof payrollGenerateSchema>;
export type PayrollUpdateInput = z.infer<typeof payrollUpdateSchema>;
