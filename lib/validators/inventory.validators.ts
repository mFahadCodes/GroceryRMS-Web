import { z } from "zod";
import { decimalSchema, optionalPaisaSchema, paisaSchema } from "./common";

export const stockMovementTypeSchema = z.enum([
  "Purchase",
  "Consumption",
  "Waste",
  "Adjustment",
  "Sale",
  "Return",
]);

export const createStockMovementSchema = z.object({
  productId: z.number().int().positive(),
  type: stockMovementTypeSchema,
  quantity: decimalSchema,
  costAmount: optionalPaisaSchema,
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  newStockLevel: decimalSchema.optional(),
});

export const purchaseOrderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: decimalSchema,
  unitCost: paisaSchema,
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.number().int().positive(),
  expectedDelivery: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(purchaseOrderItemSchema).min(1),
});

export const purchaseOrderReceiveItemSchema = z.object({
  purchaseOrderItemId: z.number().int().positive(),
  receivedQty: decimalSchema,
});

export const receivePurchaseOrderSchema = z.object({
  items: z.array(purchaseOrderReceiveItemSchema).min(1),
});

export const createStockTakeSchema = z.object({
  notes: z.string().optional().nullable(),
});

export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type CreateStockTakeInput = z.infer<typeof createStockTakeSchema>;
