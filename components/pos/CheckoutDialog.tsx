"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatPKR } from "@/lib/currency";
import { Receipt } from "@/components/pos/Receipt";
import type { ReceiptOrder } from "@/components/pos/receipt-types";
import {
  abandonCheckoutAttempt,
  loadCheckoutRecoveryAttempt,
  submitCheckoutWithIdempotency,
  type FinancialAttemptRecord,
} from "@/lib/financial-idempotency";
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
  const submitLockRef = useRef(false);

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
  const [recoveryAttempt, setRecoveryAttempt] =
    useState<FinancialAttemptRecord | null>(null);
  const [reconcileOrder, setReconcileOrder] = useState<ReceiptOrder | null>(
    null,
  );

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
      setReconcileOrder(null);
      setRecoveryAttempt(loadCheckoutRecoveryAttempt());
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

  function checkoutFields() {
    if (terminalId === null || terminalId === undefined) {
      throw new Error("Terminal is required for checkout");
    }
    return {
      paymentMethodId,
      tenderedAmount: tenderedBig,
      terminalId,
      discountPercent,
      taxPercent,
    };
  }

  async function runProtectedCheckout(orderId: number) {
    const result = await submitCheckoutWithIdempotency<ReceiptOrder>({
      orderId,
      fields: checkoutFields(),
    });

    if (result.ok) {
      setRecoveryAttempt(null);
      setReconcileOrder(null);
      const closed = result.data;
      if (!closed?.orderNumber || closed.status !== "Closed") {
        throw new Error(
          closed?.orderNumber
            ? "Checkout did not close the order — sale was not completed"
            : "Checkout succeeded but order confirmation was missing",
        );
      }
      if (
        !closed.cashier ||
        !closed.orderItems?.length ||
        !closed.payments?.length
      ) {
        throw new Error("Checkout response is missing receipt data");
      }
      await finalizeSale(closed);
      return;
    }

    setRecoveryAttempt(result.attempt ?? loadCheckoutRecoveryAttempt());

    if (result.classification.requiresOrderRefresh) {
      try {
        const order = await apiFetch<ReceiptOrder>(`/api/orders/${orderId}`);
        setReconcileOrder(order);
        if (order.status === "Closed" && order.orderNumber) {
          failCheckout(
            `${result.classification.message} Order #${orderId} is already closed — confirm receipt before starting a new sale.`,
          );
          return;
        }
      } catch {
        // Refresh is best-effort; surface the financial classification message.
      }
    }

    const suffix = result.attempt
      ? ` (order #${orderId} — previous attempt retained; retry or abandon)`
      : orderId
        ? ` (order #${orderId} may be left open — retry or void it)`
        : "";
    failCheckout(`${result.classification.message}${suffix}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;
    if (items.length === 0) return;
    if (!shiftId) {
      failCheckout("Open a shift before checkout");
      return;
    }
    if (terminalId === null || terminalId === undefined) {
      failCheckout("Terminal is required for checkout");
      return;
    }
    if (tenderedBig < grandTotal) {
      failCheckout("Tendered amount is less than total");
      return;
    }
    if (recoveryAttempt) {
      failCheckout(
        `A previous checkout attempt for order #${recoveryAttempt.resourceId} is still retained. Retry that attempt, refresh order status, or abandon it before starting a new sale.`,
      );
      return;
    }

    submitLockRef.current = true;
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

      await runProtectedCheckout(order.id);
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
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleRetryRecovery() {
    if (!recoveryAttempt || submitLockRef.current || submitting) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await runProtectedCheckout(recoveryAttempt.resourceId);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Checkout retry failed";
      failCheckout(
        `${message} (order #${recoveryAttempt.resourceId} — previous attempt retained; retry or abandon)`,
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleRefreshRecoveryOrder() {
    if (!recoveryAttempt) return;
    try {
      const order = await apiFetch<ReceiptOrder>(
        `/api/orders/${recoveryAttempt.resourceId}`,
      );
      setReconcileOrder(order);
      if (order.status === "Closed" && order.orderNumber) {
        abandonCheckoutAttempt(recoveryAttempt.resourceId);
        setRecoveryAttempt(null);
        await finalizeSale(order);
      }
    } catch (err) {
      failCheckout(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to refresh order status",
      );
    }
  }

  function handleAbandonRecovery() {
    if (!recoveryAttempt) return;
    abandonCheckoutAttempt(recoveryAttempt.resourceId);
    setRecoveryAttempt(null);
    setReconcileOrder(null);
    setError(null);
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
          <div
            className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-dialog-title"
            aria-busy={submitting}
          >
            <h2 id="checkout-dialog-title" className="text-xl font-semibold">
              Checkout
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Total due: {formatPKR(grandTotal)}
            </p>

            {recoveryAttempt ? (
              <div
                className="mt-4 space-y-3 rounded-lg border border-border bg-muted/40 p-3"
                role="status"
                aria-live="polite"
              >
                <p className="text-sm">
                  Previous checkout attempt for order #
                  {recoveryAttempt.resourceId} is retained (
                  {recoveryAttempt.state}). It will not auto-submit after refresh.
                  Retry with the same key, refresh order status, or abandon
                  before starting a new sale.
                </p>
                {reconcileOrder ? (
                  <p className="text-xs text-muted-foreground">
                    Authoritative status: {reconcileOrder.status}
                    {reconcileOrder.orderNumber
                      ? ` · ${reconcileOrder.orderNumber}`
                      : ""}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleRetryRecovery}
                    disabled={submitting}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {submitting ? "Processing…" : "Retry retained attempt"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshRecoveryOrder}
                    disabled={submitting}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Refresh order status
                  </button>
                  <button
                    type="button"
                    onClick={handleAbandonRecovery}
                    disabled={submitting}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Abandon attempt
                  </button>
                </div>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Payment method
                </label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(Number(e.target.value))}
                  disabled={submitting || Boolean(recoveryAttempt)}
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
                  disabled={submitting || Boolean(recoveryAttempt)}
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
                <p
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
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
                  disabled={submitting || Boolean(recoveryAttempt)}
                  aria-busy={submitting}
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
