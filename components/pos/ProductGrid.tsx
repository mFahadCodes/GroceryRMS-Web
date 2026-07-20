"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";
import { cn } from "@/lib/utils";

export type ProductRow = {
  id: number;
  name: string;
  basePrice: string;
  barcode: string | null;
  categoryId: number;
  category: { id: number; name: string };
};

type Props = {
  categoryId: number | null;
  onSelect: (product: ProductRow) => void;
};

export function ProductGrid({ categoryId, onSelect }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["products", categoryId],
    queryFn: () =>
      apiFetch<{ items: ProductRow[] }>(
        `/api/products?limit=100${categoryId ? `&categoryId=${categoryId}` : ""}`,
      ),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="p-4 text-sm text-destructive">
        Failed to load products. Ensure you are logged in.
      </p>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-4">
      {items.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onSelect(product)}
          className={cn(
            "flex flex-col items-start rounded-xl border border-border bg-card p-4 text-left",
            "transition-colors hover:border-primary hover:bg-accent",
          )}
        >
          <span className="font-medium leading-tight">{product.name}</span>
          <span className="mt-2 text-sm text-muted-foreground">
            {product.category.name}
          </span>
          <span className="mt-auto pt-2 text-sm font-semibold">
            {formatPKR(BigInt(product.basePrice))}
          </span>
        </button>
      ))}
    </div>
  );
}
