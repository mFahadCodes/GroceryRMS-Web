import { z } from "zod";
import { dateOnlySchema, paginationSchema } from "./common";

export { dateOnlySchema };

export const reportDateRangeQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const reportDateQuerySchema = z.object({
  date: dateOnlySchema.optional(),
  terminalId: z.coerce.number().int().positive().optional(),
});

export const reportQuerySchema = z.object({
  type: z.enum(["daily", "salesByCategory", "peakHour"]),
  date: dateOnlySchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  terminalId: z.coerce.number().int().positive().optional(),
});

export const salesReportQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  mode: z.enum(["all", "bill"]).default("bill"),
});

export const driverPerformanceQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
});

export const expiryReportQuerySchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditLogQuerySchema = paginationSchema;

export type ReportDateRangeQuery = z.infer<typeof reportDateRangeQuerySchema>;
export type ReportDateQuery = z.infer<typeof reportDateQuerySchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type DriverPerformanceQuery = z.infer<typeof driverPerformanceQuerySchema>;
export type ExpiryReportQuery = z.infer<typeof expiryReportQuerySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
