"use client";

import { useEffect } from "react";

type ToastVariant = "success" | "error";

export function Toast({
  message,
  variant = "success",
  onClose,
}: {
  message: string | null;
  variant?: ToastVariant;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, variant === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [message, onClose, variant]);

  if (!message) return null;

  const styles =
    variant === "error"
      ? "bg-red-600 text-white"
      : "bg-emerald-600 text-white";

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${styles}`}
      role="alert"
    >
      {message}
    </div>
  );
}
