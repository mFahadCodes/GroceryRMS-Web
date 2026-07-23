import { apiFetch, ApiError } from "@/lib/api/client";
import { PERMS } from "@/lib/api/permissions";
import { formatPKR } from "@/lib/currency";
import { hasSessionPermission } from "@/components/layout/navigation";

export type DashboardAccess = {
  orders: boolean;
  inventory: boolean;
  shift: boolean;
};

export type CurrentShift = {
  id: number;
  startedAt: string;
  terminal: {
    id: number;
    name: string;
    location: string | null;
  } | null;
};

export type RecentOrder = {
  id: number;
  orderNumber: string;
  status: string;
  orderType: string;
  grandTotal: string;
  createdAt: string;
};

export type RecentOrdersResponse = {
  items: RecentOrder[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type LowStockProduct = {
  id: number;
  name: string;
  sku: string | null;
  currentStock: string;
  reorderLevel: string;
  unitOfMeasure: string;
};

export function getDashboardAccess(
  permissions: readonly string[],
): DashboardAccess {
  const tokens = [...permissions];
  return {
    orders: hasSessionPermission(tokens, PERMS.CREATE_ORDERS, 1),
    inventory: hasSessionPermission(tokens, PERMS.MANAGE_INVENTORY, 1),
    shift: hasSessionPermission(tokens, PERMS.OPEN_CLOSE_SHIFT, 1),
  };
}

export function hasAnyDashboardAccess(access: DashboardAccess) {
  return access.orders || access.inventory || access.shift;
}

export function isPermissionDenied(error: unknown) {
  return error instanceof ApiError && error.status === 403;
}

export function formatShiftDuration(startedAt: string, now: Date) {
  const start = new Date(startedAt);
  const elapsedMilliseconds = Math.max(0, now.getTime() - start.getTime());
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function getTerminalLabel(shift: CurrentShift | null | undefined) {
  if (!shift?.terminal) return "No terminal assigned";
  return shift.terminal.location
    ? `${shift.terminal.name} · ${shift.terminal.location}`
    : shift.terminal.name;
}

export function formatBackendMoney(value: string | null | undefined) {
  if (!value || !/^-?\d+$/.test(value)) return "Unavailable";
  return formatPKR(BigInt(value));
}

export function formatDashboardDateTime(value: string | null | undefined) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function fetchCurrentShift() {
  return apiFetch<CurrentShift | null>("/api/shifts");
}

export function fetchRecentOrders() {
  return apiFetch<RecentOrdersResponse>(
    "/api/orders?page=1&pageSize=5&scope=today",
  );
}

export function fetchLowStockProducts() {
  return apiFetch<LowStockProduct[]>("/api/inventory/low-stock");
}
