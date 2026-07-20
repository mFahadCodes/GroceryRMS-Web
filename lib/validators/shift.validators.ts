import { z } from "zod";
import { paisaSchema } from "./common";

export const openShiftSchema = z.object({
  action: z.literal("open"),
  terminalId: z.number().int().positive().optional().nullable(),
  openingBalance: paisaSchema,
  notes: z.string().optional().nullable(),
});

export const closeShiftSchema = z.object({
  action: z.literal("close"),
  shiftId: z.number().int().positive(),
  closingBalance: paisaSchema,
  notes: z.string().optional().nullable(),
});

export const shiftActionSchema = z.discriminatedUnion("action", [
  openShiftSchema,
  closeShiftSchema,
]);

export const shiftQuerySchema = z.object({
  terminalId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.coerce.number().int().positive().optional(),
});

export const shiftCloseBodySchema = z.object({
  closingBalance: paisaSchema,
  notes: z.string().optional().nullable(),
});

export const cashDrawerLogSchema = z.object({
  type: z.enum(["PayIn", "PayOut"]),
  amount: paisaSchema,
  description: z.string().optional().nullable(),
  orderId: z.number().int().positive().optional(),
});

export const cashDrawerLogQuerySchema = z.object({
  type: z.enum(["PayIn", "PayOut"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ShiftActionInput = z.infer<typeof shiftActionSchema>;
export type ShiftCloseBodyInput = z.infer<typeof shiftCloseBodySchema>;
export type CashDrawerLogInput = z.infer<typeof cashDrawerLogSchema>;
export type CashDrawerLogQuery = z.infer<typeof cashDrawerLogQuerySchema>;
