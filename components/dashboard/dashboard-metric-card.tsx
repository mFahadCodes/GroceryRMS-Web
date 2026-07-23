import type { LucideIcon } from "lucide-react";

export function DashboardMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  loading = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  loading?: boolean;
}) {
  return (
    <article
      aria-busy={loading || undefined}
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <div
              role="status"
              aria-label={`Loading ${label.toLowerCase()}`}
              className="mt-3 h-8 w-20 animate-pulse rounded bg-muted"
            />
          ) : (
            <p className="mt-2 truncate text-2xl font-semibold tracking-tight">
              {value}
            </p>
          )}
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </div>
    </article>
  );
}
