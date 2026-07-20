"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";
import { Receipt } from "@/components/pos/Receipt";
import type { ReceiptOrder } from "@/components/pos/receipt-types";
import {
  cartTotals,
  useCartStore,
} from "@/stores/cart.store";
import { useShiftStore } from "@/stores/shift.store";

type PaymentMethod = {
  id: number;
  name: string;
  code: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
  onError: (message: string) => void;
};

const RECEIPT_PAGE_STYLE = `
  @page {
    size: 80mm auto;
    margin: 2mm;
  }
  body {
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`;

export function CheckoutDialog({
  open,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const items = useCartStore((s) => s.items);
  const orderType = useCartStore((s) => s.orderType);
  const discountPercent = useCartStore((s) => s.discountPercent);
  const taxPercent = useCartStore((s) => s.taxPercent);
  const clear = useCartStore((s) => s.clear);

  const terminalId = useShiftStore((s) => s.terminalId);
  const shiftId = useShiftStore((s) => s.shiftId);

  const receiptRef = useRef<HTMLDivElement>(null);
  const [receiptOrder, setReceiptOrder] = useState<ReceiptOrder | null>(null);

  const { grandTotal } = useMemo(
    () => cartTotals(items, discountPercent, taxPercent),
    [items, discountPercent, taxPercent],
  );

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch<PaymentMethod[]>("/api/payment-methods"),
    enabled: open,
  });

  const [paymentMethodId, setPaymentMethodId] = useState(1);
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: receiptOrder
      ? `Receipt-${receiptOrder.orderNumber}`
      : "Receipt",
    pageStyle: RECEIPT_PAGE_STYLE,
    onPrintError: (_location, printError) => {
      onError(
        printError instanceof Error
          ? printError.message
          : "Failed to open print dialog",
      );
    },
    onAfterPrint: () => setReceiptOrder(null),
  });

  useEffect(() => {
    if (open) {
      setTendered(grandTotal.toString());
      setError(null);
    }
  }, [open, grandTotal]);

  const tenderedBig = tendered ? BigInt(tendered) : 0n;
  const changeDue = tenderedBig >= grandTotal ? tenderedBig - grandTotal : 0n;

  function failCheckout(message: string) {
    setError(message);
    onError(message);
    setReceiptOrder(null);
  }

  async function finalizeSale(closed: ReceiptOrder) {
    setReceiptOrder(closed);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    try {
      await printReceipt();
    } catch (err) {
      failCheckout(
        err instanceof Error ? err.message : "Failed to open print dialog",
      );
      return;
    }

    clear();
    onSuccess(closed.orderNumber);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    if (!shiftId) {
      failCheckout("Open a shift before checkout");
      return;
    }
    if (tenderedBig < grandTotal) {
      failCheckout("Tendered amount is less than total");
      return;
    }

    setSubmitting(true);
    setError(null);

    let orderId: number | null = null;

    try {
      const order = await apiFetch<{ id: number; orderNumber: string }>(
        "/api/orders",
        {
          method: "POST",
          body: JSON.stringify({
            orderType,
            terminalId,
            shiftId,
          }),
        },
      );

      if (!order?.id) {
        throw new Error("Failed to create order — no order id returned");
      }
      orderId = order.id;

      for (const line of items) {
        await apiFetch(`/api/orders/${order.id}`, {
          method: "PUT",
          body: JSON.stringify({
            action: "addItem",
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            scannedBarcode: line.barcode,
          }),
        });
      }

      const closed = await apiFetch<ReceiptOrder>(
        `/api/orders/${order.id}/checkout`,
        {
          method: "POST",
          body: JSON.stringify({
            paymentMethodId,
            tenderedAmount: tenderedBig.toString(),
            terminalId,
            discountPercent,
            taxPercent,
          }),
        },
      );

      if (!closed?.orderNumber || closed.status !== "Closed") {
        throw new Error(
          closed?.orderNumber
            ? "Checkout did not close the order — sale was not completed"
            : "Checkout succeeded but order confirmation was missing",
        );
      }

      if (!closed.cashier || !closed.orderItems?.length || !closed.payments?.length) {
        throw new Error("Checkout response is missing receipt data");
      }

      await finalizeSale(closed);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Checkout failed";
      failCheckout(
        orderId
          ? `${message} (order #${orderId} may be left open — retry or void it)`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ display: "none" }} aria-hidden="true">
        <div ref={receiptRef}>
          {receiptOrder ? <Receipt order={receiptOrder} /> : null}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl">
            <h2 className="text-xl font-semibold">Checkout</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Total due: {formatPKR(grandTotal)}
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Payment method
                </label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(Number(e.target.value))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {paymentMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Tendered (paisa)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={tendered}
                  onChange={(e) =>
                    setTendered(e.target.value.replace(/\D/g, ""))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPKR(tenderedBig || 0n)} tendered
                </p>
              </div>

              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between font-medium">
                  <span>Change due</span>
                  <span>{formatPKR(changeDue)}</span>
                </div>
              </div>

              {error ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {submitting ? "Processing…" : "Complete sale"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
