import { z } from "zod";

export const loginBodySchema = z.union([
  z
    .object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      userId: z.number().int().positive(),
      pin: z.string().regex(/^[0-9]{4}$/),
    })
    .strict(),
]);

export const validatePinSchema = z
  .object({
    userId: z.number().int().positive(),
    pin: z.string().regex(/^[0-9]{4}$/),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(1).max(1024),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ValidatePinInput = z.infer<typeof validatePinSchema>;
