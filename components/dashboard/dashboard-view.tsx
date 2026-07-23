"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
} from "lucide-react";
import { DashboardMetricCard } from "@/components/dashboard/dashboard-metric-card";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import {
  EmptyState,
  InlineErrorState,
  LoadingSkeleton,
  NoAccessState,
} from "@/components/dashboard/dashboard-states";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  fetchCurrentShift,
  fetchLowStockProducts,
  fetchRecentOrders,
  formatBackendMoney,
  formatDashboardDateTime,
  formatShiftDuration,
  getDashboardAccess,
  getTerminalLabel,
  hasAnyDashboardAccess,
  isPermissionDenied,
} from "@/components/dashboard/dashboard-data";
import {
  getVisibleNavigation,
  navigationItems,
} from "@/components/layout/navigation";

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-10 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Retry
    </button>
  );
}
export function DashboardView() {
  const { data: session, status: sessionStatus } = useSession();
  const permissions = session?.user.permissions ?? [];
  const access = getDashboardAccess(permissions);

  const shiftQuery = useQuery({
    queryKey: ["dashboard", "current-shift"],
    queryFn: fetchCurrentShift,
    enabled: sessionStatus === "authenticated" && access.shift,
    retry: false,
  });

  const ordersQuery = useQuery({
    queryKey: ["dashboard", "recent-orders"],
    queryFn: fetchRecentOrders,
    enabled: sessionStatus === "authenticated" && access.orders,
    retry: false,
  });

  const stockQuery = useQuery({
    queryKey: ["dashboard", "low-stock"],
    queryFn: fetchLowStockProducts,
    enabled: sessionStatus === "authenticated" && access.inventory,
    retry: false,
  });

  if (sessionStatus === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {["Shift", "Orders", "Inventory"].map((label) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-5 shadow-sm"
          >
            <LoadingSkeleton label={`Loading ${label.toLowerCase()}`} lines={2} />
          </div>
        ))}
      </div>
    );
  }

  if (!hasAnyDashboardAccess(access)) {
    return <NoAccessState />;
  }

  const quickLinks = getVisibleNavigation(permissions).filter(
    (item) => item.href !== "/" && item !== navigationItems[0],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {access.shift ? (
          <DashboardMetricCard
            label="Current shift"
            value={
              shiftQuery.isPending
                ? "Loading"
                : shiftQuery.isError
                  ? isPermissionDenied(shiftQuery.error)
                    ? "Restricted"
                    : "Unavailable"
                  : shiftQuery.data
                    ? "Open"
                    : "Not open"
            }
            detail={
              shiftQuery.data
                ? getTerminalLabel(shiftQuery.data)
                : "Your active register session"
            }
            icon={Clock3}
            loading={shiftQuery.isPending}
          />
        ) : null}
        {access.orders ? (
          <DashboardMetricCard
            label="Today's orders"
            value={
              ordersQuery.isPending
                ? "Loading"
                : ordersQuery.isError
                  ? isPermissionDenied(ordersQuery.error)
                    ? "Restricted"
                    : "Unavailable"
                  : String(ordersQuery.data?.meta.total ?? 0)
            }
            detail="Backend-provided order count"
            icon={ClipboardList}
            loading={ordersQuery.isPending}
          />
        ) : null}
        {access.inventory ? (
          <DashboardMetricCard
            label="Low-stock items"
            value={
              stockQuery.isPending
                ? "Loading"
                : stockQuery.isError
                  ? isPermissionDenied(stockQuery.error)
                    ? "Restricted"
                    : "Unavailable"
                  : String(stockQuery.data?.length ?? 0)
            }
            detail="At or below reorder level"
            icon={AlertTriangle}
            loading={stockQuery.isPending}
          />
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        {access.orders ? (
          <DashboardSection
            title="Recent orders"
            description="Latest orders created today"
            action={
              ordersQuery.isError && !isPermissionDenied(ordersQuery.error) ? (
                <RetryButton onClick={() => void ordersQuery.refetch()} />
              ) : (
                <Link
                  href="/orders"
                  className="inline-flex min-h-10 items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View all
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              )
            }
          >
            {ordersQuery.isPending ? (
              <LoadingSkeleton label="Loading recent orders" lines={5} />
            ) : ordersQuery.isError ? (
              isPermissionDenied(ordersQuery.error) ? (
                <NoAccessState
                  title="Orders unavailable"
                  description="Your current session cannot access order history."
                />
              ) : (
                <InlineErrorState
                  title="Recent orders could not be loaded"
                  onRetry={() => void ordersQuery.refetch()}
                />
              )
            ) : ordersQuery.data?.items.length ? (
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="w-full min-w-[38rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 pb-3 font-medium sm:pl-5">Order</th>
                      <th className="px-4 pb-3 font-medium">Type</th>
                      <th className="px-4 pb-3 font-medium">Status</th>
                      <th className="px-4 pb-3 text-right font-medium">Total</th>
                      <th className="px-4 pb-3 font-medium sm:pr-5">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordersQuery.data.items.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-border/70 last:border-0"
                      >
                        <td className="px-4 py-3 font-mono font-medium sm:pl-5">
                          {order.orderNumber}
                        </td>
                        <td className="px-4 py-3">{order.orderType}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatBackendMoney(order.grandTotal)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground sm:pr-5">
                          {formatDashboardDateTime(order.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No orders today"
                description="Orders created today will appear here."
              />
            )}
          </DashboardSection>
        ) : null}

        <div className="space-y-6">
          {access.shift ? (
            <DashboardSection title="Shift status">
              {shiftQuery.isPending ? (
                <LoadingSkeleton label="Loading current shift" />
              ) : shiftQuery.isError ? (
                isPermissionDenied(shiftQuery.error) ? (
                  <NoAccessState
                    title="Shift unavailable"
                    description="Your current session cannot access shift details."
                  />
                ) : (
                  <InlineErrorState
                    title="Shift status could not be loaded"
                    onRetry={() => void shiftQuery.refetch()}
                  />
                )
              ) : shiftQuery.data ? (
                <dl className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <StatusBadge status="Open" />
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Terminal</dt>
                    <dd className="text-right font-medium">
                      {getTerminalLabel(shiftQuery.data)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Duration</dt>
                    <dd className="font-medium">
                      {formatShiftDuration(shiftQuery.data.startedAt, new Date())}
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyState
                  title="No open shift"
                  description="Open a shift from POS when you are ready to trade."
                />
              )}
            </DashboardSection>
          ) : null}

          {access.inventory ? (
            <DashboardSection
              title="Stock attention"
              action={
                stockQuery.isError && !isPermissionDenied(stockQuery.error) ? (
                  <RetryButton onClick={() => void stockQuery.refetch()} />
                ) : (
                  <Link
                    href="/inventory"
                    className="inline-flex min-h-10 items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Inventory
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                )
              }
            >
              {stockQuery.isPending ? (
                <LoadingSkeleton label="Loading low-stock items" />
              ) : stockQuery.isError ? (
                isPermissionDenied(stockQuery.error) ? (
                  <NoAccessState
                    title="Inventory unavailable"
                    description="Your current session cannot access inventory alerts."
                  />
                ) : (
                  <InlineErrorState
                    title="Low-stock items could not be loaded"
                    onRetry={() => void stockQuery.refetch()}
                  />
                )
              ) : stockQuery.data?.length ? (
                <ul className="divide-y divide-border text-sm">
                  {stockQuery.data.slice(0, 5).map((product) => (
                    <li
                      key={product.id}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {product.sku ?? "No SKU"}
                        </p>
                      </div>
                      <span className="shrink-0 text-amber-800">
                        {product.currentStock} {product.unitOfMeasure}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="Stock levels are healthy"
                  description="No active products are at or below their reorder level."
                />
              )}
            </DashboardSection>
          ) : null}
        </div>
      </div>

      {quickLinks.length ? (
        <DashboardSection
          title="Quick navigation"
          description="Open the areas available to your role"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex min-h-14 items-center justify-between rounded-lg border border-border px-4 py-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            ))}
          </div>
        </DashboardSection>
      ) : null}
    </div>
  );
}
