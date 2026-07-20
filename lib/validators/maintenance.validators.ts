import { z } from "zod";

export const restoreFileSchema = z.object({
  filename: z.string().min(1),
  confirmText: z.literal("RESTORE"),
});

export type RestoreFileInput = z.infer<typeof restoreFileSchema>;
