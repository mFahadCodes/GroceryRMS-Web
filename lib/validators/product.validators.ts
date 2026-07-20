import { z } from "zod";
import { decimalSchema, optionalPaisaSchema, paisaSchema } from "./common";

export const productVariantSchema = z.object({
  name: z.string().min(1),
  priceOverride: paisaSchema,
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
});

export const updateProductVariantSchema = z.object({
  name: z.string().min(1).optional(),
  priceOverride: paisaSchema.optional(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
});

export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  basePrice: paisaSchema,
  costPrice: paisaSchema,
  categoryId: z.number().int().positive(),
  taxRateId: z.number().int().positive().optional().nullable(),
  maxDiscount: optionalPaisaSchema,
  displayOrder: z.number().int().default(0),
  unitOfMeasure: z.string().default("ea"),
  isWeighted: z.boolean().default(false),
  currentStock: decimalSchema.optional(),
  reorderLevel: decimalSchema.optional(),
  expiryDate: z.string().datetime().optional().nullable(),
  batchNumber: z.string().optional().nullable(),
  variants: z.array(productVariantSchema).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  barcode: z.string().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  activeOnly: z.coerce.boolean().default(true),
  stockStatus: z.enum(["low", "ok", "out"]).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;
