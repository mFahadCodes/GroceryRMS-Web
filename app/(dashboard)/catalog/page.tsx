"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";

type Product = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: string;
  category: { name: string };
};

type Category = { id: number; name: string; _count?: { products: number } };

export default function CatalogPage() {
  const { data: productsData } = useQuery({
    queryKey: ["catalog-products"],
    queryFn: () =>
      apiFetch<{ items: Product[] }>("/api/products?limit=100"),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Catalog</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Products and categories
      </p>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Categories</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left">ID</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right">Products</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-2">{c.id}</td>
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 text-right">
                    {c._count?.products ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Products</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-4 py-2 text-left">Barcode</th>
                <th className="px-4 py-2 text-left">Category</th>
                <th className="px-4 py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {(productsData?.items ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2">{p.sku ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.barcode ?? "—"}
                  </td>
                  <td className="px-4 py-2">{p.category.name}</td>
                  <td className="px-4 py-2 text-right">
                    {formatPKR(BigInt(p.basePrice))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
