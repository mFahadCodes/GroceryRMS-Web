"use client";

import { useState } from "react";
import { BarcodeScanner } from "@/components/pos/BarcodeScanner";
import { CartSidebar } from "@/components/pos/CartSidebar";
import { CategoryFilter } from "@/components/pos/CategoryFilter";
import { CheckoutDialog } from "@/components/pos/CheckoutDialog";
import { ProductGrid, type ProductRow } from "@/components/pos/ProductGrid";
import { ShiftBanner } from "@/components/pos/ShiftBanner";
import { Toast } from "@/components/ui/toast";
import { useCartStore } from "@/stores/cart.store";

type ToastState = {
  message: string;
  variant: "success" | "error";
};

export default function PosPage() {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const addProduct = useCartStore((s) => s.addProduct);

  function handleSelectProduct(product: ProductRow) {
    addProduct({
      id: product.id,
      name: product.name,
      basePrice: product.basePrice,
      barcode: product.barcode,
    });
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      <ShiftBanner
        onNotify={(message, variant) => setToast({ message, variant })}
      />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col overflow-hidden">
          <CategoryFilter selectedId={categoryId} onChange={setCategoryId} />
          <BarcodeScanner onProductFound={handleSelectProduct} />
          <div className="flex-1 overflow-y-auto">
            <ProductGrid
              categoryId={categoryId}
              onSelect={handleSelectProduct}
            />
          </div>
        </div>
        <CartSidebar onCheckout={() => setCheckoutOpen(true)} />
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onSuccess={(orderNumber) =>
          setToast({ message: `Sale complete — ${orderNumber}`, variant: "success" })
        }
        onError={(message) =>
          setToast({ message, variant: "error" })
        }
      />
      <Toast
        message={toast?.message ?? null}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
