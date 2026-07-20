import { z } from "zod";
import { paisaSchema } from "./common";

export const promotionItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1),
});

export const createPromotionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  dealPrice: paisaSchema,
  originalPrice: paisaSchema,
  displayOrder: z.number().int().min(0).default(0),
  imageUrl: z.string().optional().nullable(),
  categoryId: z.number().int().positive().optional().nullable(),
  items: z.array(promotionItemSchema).min(1),
});

export const updatePromotionSchema = createPromotionSchema.partial();

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
