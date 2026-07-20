export const ORDER_TYPE = {
  WALK_IN: "WalkIn",
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
} as const;

export const ORDER_STATUS = {
  OPEN: "Open",
  PACKED: "Packed",
  CLOSED: "Closed",
  VOID: "Void",
} as const;

export const PAYMENT_STATUS = {
  PENDING: "Pending",
  PARTIAL: "Partial",
  PAID: "Paid",
  REFUNDED: "Refunded",
} as const;

export const STOCK_MOVEMENT_TYPE = {
  PURCHASE: "Purchase",
  CONSUMPTION: "Consumption",
  WASTE: "Waste",
  ADJUSTMENT: "Adjustment",
  SALE: "Sale",
  RETURN: "Return",
} as const;

export const CUSTOMER_TIER = {
  REGULAR: "Regular",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
} as const;

export const LOYALTY_TRANSACTION_TYPE = {
  EARN: "Earn",
  REDEEM: "Redeem",
  ADJUST: "Adjust",
  EXPIRE: "Expire",
} as const;

export const CASH_DRAWER_LOG_TYPE = {
  SALE: "Sale",
  REFUND: "Refund",
  PAY_IN: "PayIn",
  PAY_OUT: "PayOut",
  TIP: "Tip",
} as const;

export const SYNC_STATUS = {
  PENDING: "Pending",
  SYNCING: "Syncing",
  SYNCED: "Synced",
  FAILED: "Failed",
} as const;

export function enumValues<T extends Record<string, string>>(obj: T) {
  return Object.values(obj) as Array<T[keyof T]>;
}
