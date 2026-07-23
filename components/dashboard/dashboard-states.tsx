import { AlertCircle, Inbox, LockKeyhole, RefreshCw } from "lucide-react";

export function LoadingSkeleton({
  label = "Loading section",
  lines = 3,
}: {
  label?: string;
  lines?: number;
}) {
  return (
    <div
      aria-label={label}
      aria-busy="true"
      role="status"
      className="animate-pulse space-y-3"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="h-4 rounded bg-muted"
          style={{ width: `${Math.max(45, 100 - index * 18)}%` }}
        />
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center">
      <Inbox aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function InlineErrorState({
  title = "This section is unavailable",
  onRetry,
}: {
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
    >
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm text-red-700">
            Try again, or continue using the other dashboard sections.
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium outline-none hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function NoAccessState({
  title = "Operational overview unavailable",
  description = "Your role does not include access to dashboard operational data.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-8 text-center shadow-sm">
      <LockKeyhole
        aria-hidden="true"
        className="mx-auto size-7 text-muted-foreground"
      />
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
