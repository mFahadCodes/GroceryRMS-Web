import { z } from "zod";

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (expected YYYY-MM-DD)");

export const phoneSchema = z
  .string()
  .regex(
    /^\+?\d{10,15}$/,
    "Phone must be 10-15 digits with an optional + prefix",
  );

export const cnicSchema = z
  .string()
  .regex(/^\d{13}$/, "CNIC must be exactly 13 digits");

/** Parse paisa from JSON number or string (BigInt-safe) */
export const paisaSchema = z
  .union([z.string().regex(/^-?\d+$/), z.number().int().finite()])
  .transform((v) => BigInt(v));

export const optionalPaisaSchema = paisaSchema.optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const decimalSchema = z.union([
  z.string(),
  z.number(),
]);

export function parseSearchParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const out: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
