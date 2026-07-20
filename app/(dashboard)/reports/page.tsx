"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";
import { toLocalDateString } from "@/lib/date-range";

type DailySummary = {
  totalOrders: number;
  totalRevenue: string;
  totalTax: string;
  totalDiscount: string;
  cashSales: string;
  cardSales: string;
  digitalSales: string;
  voidedOrders: number;
  peakHour: number;
};

type CategorySale = { category: string; total: string };
type PeakHourData = {
  peakHour: number;
  peakTotal: string;
  hourly: { hour: number; total: string }[];
};

export default function ReportsPage() {
  const today = toLocalDateString();

  const { data: daily } = useQuery({
    queryKey: ["report-daily", today],
    queryFn: () =>
      apiFetch<DailySummary>(`/api/reports?type=daily&date=${today}`),
  });

  const { data: byCategory = [] } = useQuery({
    queryKey: ["report-category", today],
    queryFn: () =>
      apiFetch<CategorySale[]>(
        `/api/reports?type=salesByCategory&from=${today}&to=${today}`,
      ),
  });

  const { data: peak } = useQuery({
    queryKey: ["report-peak", today],
    queryFn: () =>
      apiFetch<PeakHourData>(`/api/reports?type=peakHour&date=${today}`),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Daily performance — {today}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue"
          value={daily ? formatPKR(BigInt(daily.totalRevenue)) : "—"}
        />
        <StatCard
          label="Orders"
          value={daily ? String(daily.totalOrders) : "—"}
        />
        <StatCard
          label="Tax collected"
          value={daily ? formatPKR(BigInt(daily.totalTax)) : "—"}
        />
        <StatCard
          label="Peak hour"
          value={
            peak
              ? `${peak.peakHour}:00 (${formatPKR(BigInt(peak.peakTotal))})`
              : "—"
          }
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">Payment breakdown</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row
              label="Cash"
              value={
                daily ? formatPKR(BigInt(daily.cashSales)) : "—"
              }
            />
            <Row
              label="Card"
              value={
                daily ? formatPKR(BigInt(daily.cardSales)) : "—"
              }
            />
            <Row
              label="Digital"
              value={
                daily ? formatPKR(BigInt(daily.digitalSales)) : "—"
              }
            />
          </dl>
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">Sales by category</h2>
          {byCategory.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No sales yet</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {byCategory.map((row) => (
                <li key={row.category} className="flex justify-between">
                  <span>{row.category}</span>
                  <span className="font-medium">
                    {formatPKR(BigInt(row.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
