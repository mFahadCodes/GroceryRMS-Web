import { z } from "zod";

export const loginBodySchema = z
  .object({
    username: z.string().optional(),
    password: z.string().optional(),
    pin: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasPin = Boolean(data.pin?.trim());
      const hasPassword = Boolean(data.username?.trim() && data.password);
      return hasPin || hasPassword;
    },
    { message: "Provide username/password or pin" },
  );

export const validatePinSchema = z.object({
  userId: z.number().int().positive(),
  pin: z.string().min(1),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(1).max(1024),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ValidatePinInput = z.infer<typeof validatePinSchema>;
