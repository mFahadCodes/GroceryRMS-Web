import { PERMS } from "@/lib/api/permissions";

export type NavigationIcon =
  | "dashboard"
  | "pos"
  | "catalog"
  | "inventory"
  | "orders"
  | "reports";

export type NavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: NavigationIcon;
  permission?: string;
};

export const navigationItems: readonly NavigationItem[] = [
  {
    href: "/",
    label: "Dashboard",
    description: "Operational overview",
    icon: "dashboard",
  },
  {
    href: "/pos",
    label: "POS",
    description: "Process customer orders",
    icon: "pos",
    permission: PERMS.CREATE_ORDERS,
  },
  {
    href: "/catalog",
    label: "Catalog",
    description: "Products and categories",
    icon: "catalog",
    permission: PERMS.VIEW_CATALOG,
  },
  {
    href: "/inventory",
    label: "Inventory",
    description: "Stock levels and movement",
    icon: "inventory",
    permission: PERMS.MANAGE_INVENTORY,
  },
  {
    href: "/orders",
    label: "Orders",
    description: "Open orders and history",
    icon: "orders",
    permission: PERMS.CREATE_ORDERS,
  },
  {
    href: "/reports",
    label: "Reports",
    description: "Performance and analytics",
    icon: "reports",
    permission: PERMS.VIEW_REPORTS,
  },
] as const;

export function hasSessionPermission(
  permissions: readonly string[],
  permissionName: string,
  minimumLevel = 1,
) {
  const target = permissionName.toLowerCase();
  return permissions.some((token) => {
    const lastColon = token.lastIndexOf(":");
    const name = lastColon === -1 ? token : token.slice(0, lastColon);
    const accessLevel =
      lastColon === -1
        ? 0
        : Number.parseInt(token.slice(lastColon + 1), 10) || 0;
    return name.toLowerCase() === target && accessLevel >= minimumLevel;
  });
}

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getVisibleNavigation(permissions: readonly string[]) {
  return navigationItems.filter(
    (item) =>
      !item.permission ||
      hasSessionPermission(permissions, item.permission, 1),
  );
}

export function getRouteContext(pathname: string) {
  const item =
    navigationItems.find((candidate) =>
      isNavigationItemActive(pathname, candidate.href),
    ) ?? navigationItems[0];

  return {
    title: item.label,
    description: item.description,
  };
}
