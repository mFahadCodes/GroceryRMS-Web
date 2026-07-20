import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type OrderType = "WalkIn" | "Pickup" | "Delivery";

export type CartLine = {
  key: string;
  productId: number;
  variantId: number | null;
  name: string;
  unitPricePaisa: string;
  quantity: number;
  barcode: string | null;
};

type CartState = {
  orderType: OrderType;
  items: CartLine[];
  discountPercent: number;
  taxPercent: number;
  setOrderType: (type: OrderType) => void;
  setDiscountPercent: (pct: number) => void;
  setTaxPercent: (pct: number) => void;
  addProduct: (product: {
    id: number;
    name: string;
    basePrice: string;
    barcode?: string | null;
    variantId?: number | null;
    variantPrice?: string;
  }) => void;
  increment: (key: string) => void;
  decrement: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
};

function lineKey(productId: number, variantId: number | null) {
  return `${productId}:${variantId ?? 0}`;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      orderType: "WalkIn",
      items: [],
      discountPercent: 0,
      taxPercent: 16,

      setOrderType: (orderType) => set({ orderType }),
      setDiscountPercent: (discountPercent) => set({ discountPercent }),
      setTaxPercent: (taxPercent) => set({ taxPercent }),

      addProduct: (product) => {
        const variantId = product.variantId ?? null;
        const key = lineKey(product.id, variantId);
        const unitPrice = product.variantPrice ?? product.basePrice;
        const existing = get().items.find((i) => i.key === key);

        if (existing) {
          set({
            items: get().items.map((i) =>
              i.key === key ? { ...i, quantity: i.quantity + 1 } : i,
            ),
          });
          return;
        }

        set({
          items: [
            ...get().items,
            {
              key,
              productId: product.id,
              variantId,
              name: product.name,
              unitPricePaisa: unitPrice,
              quantity: 1,
              barcode: product.barcode ?? null,
            },
          ],
        });
      },

      increment: (key) =>
        set({
          items: get().items.map((i) =>
            i.key === key ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        }),

      decrement: (key) =>
        set({
          items: get()
            .items.map((i) =>
              i.key === key ? { ...i, quantity: i.quantity - 1 } : i,
            )
            .filter((i) => i.quantity > 0),
        }),

      remove: (key) =>
        set({ items: get().items.filter((i) => i.key !== key) }),

      clear: () => set({ items: [] }),
    }),
    {
      name: "groceryrms-cart-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        orderType: state.orderType,
        items: state.items,
        discountPercent: state.discountPercent,
        taxPercent: state.taxPercent,
      }),
    },
  ),
);

export function cartSubtotalPaisa(items: CartLine[]): bigint {
  return items.reduce(
    (sum, line) => sum + BigInt(line.unitPricePaisa) * BigInt(line.quantity),
    0n,
  );
}

export function cartTotals(
  items: CartLine[],
  discountPercent: number,
  taxPercent: number,
) {
  const subTotal = cartSubtotalPaisa(items);
  const discountAmount =
    discountPercent > 0
      ? (subTotal * BigInt(Math.round(discountPercent))) / 100n
      : 0n;
  const net = subTotal - discountAmount;
  const taxAmount =
    taxPercent > 0 ? (net * BigInt(Math.round(taxPercent))) / 100n : 0n;
  const grandTotal = net + taxAmount;
  return { subTotal, discountAmount, taxAmount, grandTotal };
}
