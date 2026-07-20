"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";
import { toLocalDateString } from "@/lib/date-range";

type Order = {
  id: number;
  orderNumber: string;
  status: string;
  orderType: string;
  grandTotal: string;
  createdAt: string;
};

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    Open: "bg-blue-100 text-blue-800",
    Closed: "bg-emerald-100 text-emerald-800",
    Void: "bg-red-100 text-red-800",
    Packed: "bg-purple-100 text-purple-800",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

export default function OrdersPage() {
  const today = toLocalDateString();

  const { data: openOrders = [] } = useQuery({
    queryKey: ["orders-open"],
    queryFn: () => apiFetch<Order[]>("/api/orders?status=open"),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["orders-history", today],
    queryFn: () =>
      apiFetch<Order[]>(
        `/api/orders?status=history&from=${today}&to=${today}`,
      ),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Open carts and billing history
      </p>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Open orders</h2>
        <OrderTable orders={openOrders} empty="No open orders" />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Today&apos;s history</h2>
        <OrderTable orders={history} empty="No closed orders today" />
      </section>
    </div>
  );
}

function OrderTable({
  orders,
  empty,
}: {
  orders: Order[];
  empty: string;
}) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-4 py-2 text-left">Order #</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Total</th>
            <th className="px-4 py-2 text-left">Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-border">
              <td className="px-4 py-2 font-mono">{o.orderNumber}</td>
              <td className="px-4 py-2">{o.orderType}</td>
              <td className="px-4 py-2">{statusBadge(o.status)}</td>
              <td className="px-4 py-2 text-right">
                {formatPKR(BigInt(o.grandTotal))}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(o.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
