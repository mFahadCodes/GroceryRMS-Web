"use client";

import Barcode from "react-barcode";
import { formatPKR } from "@/lib/currency";
import {
  DEFAULT_STORE_INFO,
  type ReceiptOrder,
  type ReceiptStoreInfo,
} from "@/components/pos/receipt-types";

type Props = {
  order: ReceiptOrder;
  store?: ReceiptStoreInfo;
};

function formatReceiptDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function cashierLabel(order: ReceiptOrder): string {
  return order.cashier.fullName?.trim() || order.cashier.username;
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}
    >
      <span>{label}</span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}

export function Receipt({ order, store = DEFAULT_STORE_INFO }: Props) {
  const payment = order.payments[0];
  const subTotal = BigInt(order.subTotal);
  const taxAmount = BigInt(order.taxAmount);
  const discountAmount = BigInt(order.discountAmount);
  const grandTotal = BigInt(order.grandTotal);
  const tendered = payment ? BigInt(payment.tenderedAmount) : 0n;
  const changeDue = payment ? BigInt(payment.changeAmount) : 0n;

  return (
    <div className="receipt-root w-[80mm] max-w-[300px] bg-white p-3 font-mono text-black">
      <style>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 2mm;
          }
          .receipt-root {
            width: 80mm !important;
            max-width: 80mm !important;
            padding: 2mm !important;
            color: #000 !important;
            background: #fff !important;
          }
        }
      `}</style>

      <header className="border-b border-dashed border-black pb-2 text-center">
        <h1 className="text-sm font-bold uppercase">{store.name}</h1>
        <p className="mt-1 text-xs leading-tight">{store.address}</p>
        <p className="text-xs">{store.phone}</p>
      </header>

      <section className="border-b border-dashed border-black py-2 text-xs">
        <Row label="Date" value={formatReceiptDate(order.createdAt)} />
        <Row label="Order #" value={order.orderNumber} />
        <Row label="Cashier" value={cashierLabel(order)} />
      </section>

      <section className="border-b border-dashed border-black py-2">
        <div className="mb-1 flex justify-between text-[10px] font-bold uppercase">
          <span className="w-8">Qty</span>
          <span className="flex-1 px-1">Item</span>
          <span className="w-16 text-right">Amount</span>
        </div>
        <ul className="space-y-1 text-xs">
          {order.orderItems.map((item, index) => (
            <li
              key={`${item.product.name}-${index}`}
              className="flex justify-between gap-1 leading-tight"
            >
              <span className="w-8 shrink-0">{item.quantity}x</span>
              <span className="flex-1 break-words">{item.product.name}</span>
              <span className="w-16 shrink-0 text-right">
                {formatPKR(BigInt(item.lineTotal))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-0.5 border-b border-dashed border-black py-2 text-xs">
        <Row label="Subtotal" value={formatPKR(subTotal)} />
        {discountAmount > 0n ? (
          <Row label="Discount" value={`-${formatPKR(discountAmount)}`} />
        ) : null}
        {taxAmount > 0n ? (
          <Row label="Tax" value={formatPKR(taxAmount)} />
        ) : null}
        <Row label="Grand Total" value={formatPKR(grandTotal)} bold />
      </section>

      {payment ? (
        <section className="space-y-0.5 border-b border-dashed border-black py-2 text-xs">
          <Row label="Payment" value={payment.paymentMethod.name} />
          <Row label="Tendered" value={formatPKR(tendered)} />
          <Row label="Change" value={formatPKR(changeDue)} />
        </section>
      ) : null}

      <footer className="pt-3 text-center">
        <p className="text-xs font-semibold">Thank you!</p>
        <div className="mt-2 flex justify-center overflow-hidden">
          <Barcode
            value={order.orderNumber}
            format="CODE128"
            width={1.4}
            height={36}
            fontSize={10}
            margin={0}
            displayValue
          />
        </div>
      </footer>
    </div>
  );
}
