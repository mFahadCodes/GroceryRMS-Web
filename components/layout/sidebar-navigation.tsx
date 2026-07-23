import Link from "next/link";
import {
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  LayoutDashboard,
  PackageSearch,
  ShoppingBasket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isNavigationItemActive,
  type NavigationIcon,
  type NavigationItem,
} from "@/components/layout/navigation";

const icons: Record<NavigationIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ShoppingBasket,
  catalog: PackageSearch,
  inventory: Boxes,
  orders: ClipboardList,
  reports: ChartNoAxesCombined,
};

export function SidebarNavigation({
  items,
  pathname,
  label,
  compact = false,
  onNavigate,
}: {
  items: readonly NavigationItem[];
  pathname: string;
  label: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label} className="space-y-1">
      {items.map((item) => {
        const active = isNavigationItemActive(pathname, item.href);
        const Icon = icons[item.icon];

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              compact && "justify-center xl:justify-start",
            )}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span className={cn(compact && "sr-only xl:not-sr-only")}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
