import { z } from "zod";
import { paisaSchema, phoneSchema } from "./common";

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  phone: phoneSchema,
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerQuerySchema = z.object({
  phone: z.string().optional(),
  search: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createCustomerAddressSchema = z.object({
  label: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const updateCustomerAddressSchema = z.object({
  label: z.string().min(1).optional(),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const customerLoyaltyAdjustSchema = z.object({
  points: paisaSchema,
  description: z.string().optional().nullable(),
  type: z.enum(["Adjust", "Expire"]).optional().default("Adjust"),
});

export const loyaltyExpireSchema = z.object({
  customerId: z.number().int().positive().optional(),
  pointsToExpire: paisaSchema.optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateCustomerAddressInput = z.infer<typeof createCustomerAddressSchema>;
export type UpdateCustomerAddressInput = z.infer<typeof updateCustomerAddressSchema>;
export type CustomerLoyaltyAdjustInput = z.infer<typeof customerLoyaltyAdjustSchema>;
export type LoyaltyExpireInput = z.infer<typeof loyaltyExpireSchema>;
