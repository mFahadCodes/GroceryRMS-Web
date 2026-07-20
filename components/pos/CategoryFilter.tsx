"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Category = { id: number; name: string };

type Props = {
  selectedId: number | null;
  onChange: (id: number | null) => void;
};

export function CategoryFilter({ selectedId, onChange }: Props) {
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });

  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-full px-3 py-1 text-sm font-medium",
          selectedId === null
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onChange(cat.id)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium",
            selectedId === cat.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
