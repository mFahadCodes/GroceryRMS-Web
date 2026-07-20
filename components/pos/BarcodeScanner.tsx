"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { ProductRow } from "./ProductGrid";

type Props = {
  onProductFound: (product: ProductRow) => void;
};

export function BarcodeScanner({ onProductFound }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function lookupBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;

    try {
      setError(null);
      const product = await apiFetch<ProductRow>(
        `/api/products?barcode=${encodeURIComponent(trimmed)}`,
      );
      onProductFound(product);
      if (inputRef.current) inputRef.current.value = "";
      bufferRef.current = "";
    } catch {
      setError(`No product for barcode ${trimmed}`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void lookupBarcode(e.currentTarget.value);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (bufferRef.current.length >= 8) {
        void lookupBarcode(bufferRef.current);
      }
    }, 100);
  }

  return (
    <div className="border-b border-border px-4 py-2">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="Scan barcode or type & Enter…"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        autoComplete="off"
        onChange={(e) => {
          bufferRef.current = e.target.value;
        }}
        onKeyDown={handleKeyDown}
      />
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
