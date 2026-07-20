/**
 * Seeded permission names from GroceryRMS-spec.md §5.
 * Retail matrix: 24 permissions. RPOS restaurant IDs 11 (tables/sessions) and
 * 18 (kitchen orders) were intentionally omitted — no Kitchen/Floor/Table perms.
 */
export const PERMS = {
  LOGIN_AUTHENTICATION: "Login / authentication",
  VIEW_OWN_PROFILE: "View own profile",
  MANAGE_USERS_ROLES: "Manage users & roles",
  VIEW_AUDIT_LOG: "View audit log",
  CREATE_ORDERS: "Create & process orders",
  APPLY_DISCOUNTS: "Apply discounts",
  VOID_ORDERS: "Void / cancel orders",
  HOLD_RECALL_ORDERS: "Hold & recall orders",
  PROCESS_PAYMENTS: "Process payments",
  ISSUE_REFUNDS: "Issue refunds",
  MANAGE_CUSTOMERS: "Manage customers & loyalty",
  OPEN_CLOSE_SHIFT: "Open / close shift",
  CASH_DRAWER_OPERATIONS: "Cash drawer operations",
  VIEW_CATALOG: "View catalog",
  MANAGE_PRODUCTS: "Manage products",
  MANAGE_INVENTORY: "Manage inventory",
  MANAGE_EMPLOYEES: "Manage employees",
  MANAGE_SUPPLIERS: "Manage suppliers",
  MANAGE_EXPENSES: "Manage expenses",
  GENERATE_PAYROLL: "Generate payroll",
  VIEW_REPORTS: "View reports & analytics",
  MANAGE_TAX_DISCOUNTS: "Manage tax & discounts",
  MANAGE_PRINTERS_TERMINALS: "Manage printers & terminals",
  SYSTEM_APP_SETTINGS: "System app settings",

  // Backward-compatible aliases used by existing routes.
  OPEN_SHIFT: "Open / close shift",
  MANAGE_CUSTOMERS_LOYALTY: "Manage customers & loyalty",
  MANAGE_STOCK_RECIPES: "Manage inventory",
} as const;
