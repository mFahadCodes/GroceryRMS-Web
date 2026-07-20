import { Prisma } from "@prisma/client";

/** Deep-clone Prisma records for JSON — BigInt → string, Decimal → string */
export function serializeRecord<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Prisma.Decimal) return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  ) as T;
}

export function toDecimal(value: string | number | undefined | null): Prisma.Decimal {
  if (value === undefined || value === null) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}
