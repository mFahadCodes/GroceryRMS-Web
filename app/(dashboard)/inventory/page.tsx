"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

type Product = {
  id: number;
  name: string;
  sku: string | null;
  currentStock: string;
  reorderLevel: string;
  unitOfMeasure: string;
};

export default function InventoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-products"],
    queryFn: () =>
      apiFetch<{ items: Product[] }>("/api/products?limit=100"),
  });

  const items = data?.items ?? [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Stock levels from product catalog
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-4 py-2 text-right">On hand</th>
                <th className="px-4 py-2 text-right">Reorder</th>
                <th className="px-4 py-2 text-left">Unit</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const stock = Number.parseFloat(p.currentStock);
                const reorder = Number.parseFloat(p.reorderLevel);
                const low = stock <= reorder;
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">{p.sku ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{p.currentStock}</td>
                    <td className="px-4 py-2 text-right">{p.reorderLevel}</td>
                    <td className="px-4 py-2">{p.unitOfMeasure}</td>
                    <td className="px-4 py-2">
                      {low ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Low stock
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
