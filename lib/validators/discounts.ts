import { z } from "zod";
import { paisaSchema } from "./common";

export const discountTypeSchema = z.enum([
  "Percentage",
  "FixedAmount",
  "BuyXGetY",
]);

export const discountListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  type: discountTypeSchema.optional(),
});

export const createDiscountSchema = z.object({
  name: z.string().min(1),
  type: discountTypeSchema,
  value: z.union([z.string(), z.number()]),
  minOrderAmount: paisaSchema.optional().default(0n),
  maxDiscountAmount: paisaSchema.optional().default(0n),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  requiresApproval: z.boolean().optional().default(false),
  code: z.string().optional().nullable(),
});

export const updateDiscountSchema = createDiscountSchema.partial();

export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
