import { z } from "zod";

export const printReceiptBodySchema = z
  .object({
    orderId: z.number().int().positive().optional(),
    receiptData: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => data.orderId !== undefined || data.receiptData !== undefined,
    { message: "Either orderId or receiptData is required" },
  );

export const printCashDrawerBodySchema = z.object({
  terminalId: z.number().int().positive().optional(),
});

export type PrintReceiptBody = z.infer<typeof printReceiptBodySchema>;
export type PrintCashDrawerBody = z.infer<typeof printCashDrawerBodySchema>;
