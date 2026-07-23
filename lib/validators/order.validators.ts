import { z } from "zod";
import { dateOnlySchema, paisaSchema } from "./common";

export const orderTypeSchema = z.enum(["WalkIn", "Pickup", "Delivery"]);

export const createOrderSchema = z.object({
  orderType: orderTypeSchema.default("WalkIn"),
  customerId: z.number().int().positive().optional().nullable(),
  terminalId: z.number().int().positive().optional().nullable(),
  shiftId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const orderListQuerySchema = z.object({
  status: z
    .enum([
      "open",
      "history",
      "date",
      "OutForDelivery",
      "Delivered",
      "Packed",
      "PartiallyPaid",
    ])
    .optional(),
  scope: z.enum(["all", "today"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  date: dateOnlySchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  cashierId: z.coerce.number().int().positive().optional(),
});

export const orderExportQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  type: orderTypeSchema.optional(),
  status: z
    .enum([
      "Open",
      "PartiallyPaid",
      "Packed",
      "OutForDelivery",
      "Delivered",
      "Closed",
      "Void",
    ])
    .optional(),
  cashierId: z.coerce.number().int().positive().optional(),
});

export const partialPaymentSchema = z.object({
  paymentMethodId: z.number().int().positive(),
  amount: paisaSchema,
  referenceNo: z.string().optional().nullable(),
});

export const applyOrderTaxSchema = z.object({
  taxRateId: z.number().int().positive(),
});

export const applyOrderAdjustmentSchema = z.object({
  adjustment: paisaSchema,
});

export const updateOrderNotesSchema = z.object({
  notes: z.string().nullable(),
});

export const orderSearchQuerySchema = z.object({
  q: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const dispatchOrderSchema = z.object({
  driverId: z.number().int().positive(),
  estimatedDelivery: z.string().datetime().optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
});

export const returnOrderItemsSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.number().int().positive(),
        returnQty: z.number().int().positive(),
        reason: z.string().min(1),
      }),
    )
    .min(1),
  refundAmount: paisaSchema,
});

export const addItemSchema = z
  .object({
    action: z.literal("addItem"),
    productId: z.number().int().positive(),
    variantId: z.number().int().positive().optional().nullable(),
    quantity: z.number().int().min(1).default(1),
    weightKg: z.union([z.string(), z.number()]).optional().nullable(),
    notes: z.string().optional().nullable(),
    scannedBarcode: z.string().optional().nullable(),
  })
  .strict();

export const updateItemSchema = z
  .object({
    action: z.literal("updateItem"),
    orderItemId: z.number().int().positive(),
    quantity: z.number().int().min(0),
  })
  .strict();

export const removeItemSchema = z
  .object({
    action: z.literal("removeItem"),
    orderItemId: z.number().int().positive(),
    voidReason: z.string().optional().nullable(),
  })
  .strict();

export const ORDER_META_NOTES_MAX_LENGTH = 2000;

/**
 * SEC-04A safe metadata allowlist for the generic order update path.
 *
 * Only plain, non-financial, non-state metadata is accepted: `notes` (stored
 * verbatim as text, never interpreted as a command) and `customerId`. Every
 * other order field — discounts, adjustments, tax, totals, status, payments,
 * items, ownership, manager approval material — is rejected as an unknown
 * field by the strict schema and must go through its dedicated endpoint.
 * See docs/security/order-generic-update-boundary.md.
 */
export const updateOrderMetaSchema = z
  .object({
    action: z.literal("updateMeta"),
    notes: z
      .string()
      .max(ORDER_META_NOTES_MAX_LENGTH)
      .optional()
      .nullable(),
    customerId: z.number().int().positive().optional().nullable(),
  })
  .strict()
  .refine(
    (data) => data.notes !== undefined || data.customerId !== undefined,
    { message: "At least one metadata field is required" },
  );

export const modifyOrderSchema = z.discriminatedUnion("action", [
  addItemSchema,
  updateItemSchema,
  removeItemSchema,
  updateOrderMetaSchema,
]);

export const checkoutSchema = z.object({
  paymentMethodId: z.number().int().positive().optional(),
  tenderedAmount: paisaSchema.optional(),
  terminalId: z.number().int().positive(),
  discountPercent: z.number().min(0).max(100).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  customerId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  referenceNo: z.string().optional().nullable(),
  redeemPoints: paisaSchema.optional().default(0n),
  payments: z
    .array(
      z.object({
        paymentMethodId: z.number().int().positive(),
        amount: paisaSchema,
        tenderedAmount: paisaSchema.optional(),
        referenceNo: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

export const voidOrderBusinessSchema = z
  .object({
    reason: z.string().min(1),
    reverseStock: z.boolean().default(false),
  })
  .strict();

export const voidManagerApprovalTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

/** Original-execution body contract (tests / transport discovery). */
export const voidOrderSchema = z
  .object({
    reason: z.string().min(1),
    managerApprovalToken: voidManagerApprovalTokenSchema,
    reverseStock: z.boolean().default(false),
  })
  .strict();

export const holdOrderSchema = z.object({
  notes: z.string().optional().nullable(),
});

export const recallOrderSchema = z.object({
  notes: z.string().optional().nullable(),
});

export const refundOrderSchema = z.object({
  reason: z.string().min(1),
  amount: paisaSchema.optional(),
  paymentMethodId: z.number().int().positive(),
  terminalId: z.number().int().positive(),
  referenceNo: z.string().optional().nullable(),
});

export const addOrderItemBodySchema = z.object({
  productId: z.number().int().positive().optional(),
  scannedBarcode: z.string().optional(),
  variantId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().min(1).default(1),
  weightKg: z.union([z.string(), z.number()]).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const patchOrderItemBodySchema = z.object({
  quantity: z.number().int().min(0).optional(),
  notes: z.string().optional().nullable(),
  voidReason: z.string().optional().nullable(),
});

export const applyOrderDiscountSchema = z
  .object({
    discountAmount: paisaSchema.optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    managerApprovalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    reason: z.string().optional().nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.discountAmount !== undefined || data.discountPercent !== undefined,
    { message: "Either discountAmount or discountPercent is required" },
  );

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ModifyOrderInput = z.infer<typeof modifyOrderSchema>;
