import { z } from "zod";
import { decimalSchema } from "@/lib/validators/common";

export const stockTakeApplyItemSchema = z.object({
  itemId: z.number().int().positive(),
  countedQty: decimalSchema,
});

export const applyStockTakeSchema = z.object({
  items: z.array(stockTakeApplyItemSchema).min(1),
});

export type StockTakeApplyItemInput = z.infer<typeof stockTakeApplyItemSchema>;
export type ApplyStockTakeInput = z.infer<typeof applyStockTakeSchema>;
