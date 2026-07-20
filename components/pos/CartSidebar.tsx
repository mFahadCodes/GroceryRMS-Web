"use client";

import { formatPKR } from "@/lib/currency";
import {
  cartTotals,
  useCartStore,
  type OrderType,
} from "@/stores/cart.store";

type Props = {
  onCheckout: () => void;
};

const orderTypes: OrderType[] = ["WalkIn", "Pickup", "Delivery"];

export function CartSidebar({ onCheckout }: Props) {
  const items = useCartStore((s) => s.items);
  const orderType = useCartStore((s) => s.orderType);
  const discountPercent = useCartStore((s) => s.discountPercent);
  const taxPercent = useCartStore((s) => s.taxPercent);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);

  const { subTotal, discountAmount, taxAmount, grandTotal } = cartTotals(
    items,
    discountPercent,
    taxPercent,
  );

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="text-lg font-semibold">Cart</h2>
        <div className="mt-2 flex gap-1">
          {orderTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setOrderType(type)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                orderType === type
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Cart is empty</p>
        ) : (
          <ul className="space-y-3">
            {items.map((line) => {
              const lineTotal =
                BigInt(line.unitPricePaisa) * BigInt(line.quantity);
              return (
                <li
                  key={line.key}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium leading-tight">{line.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPKR(BigInt(line.unitPricePaisa))} each
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(line.key)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decrement(line.key)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => increment(line.key)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatPKR(lineTotal)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatPKR(subTotal)}</dd>
          </div>
          {discountAmount > 0n ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd>-{formatPKR(discountAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tax ({taxPercent}%)</dt>
            <dd>{formatPKR(taxAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatPKR(grandTotal)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={clear}
            disabled={items.length === 0}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCheckout}
            disabled={items.length === 0}
            className="flex-[2] rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Checkout
          </button>
        </div>
      </div>
    </div>
  );
}
