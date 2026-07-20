"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShiftStore } from "@/stores/shift.store";

type CashDrawerLog = {
  type: string;
  amount: string;
};

type ShiftData = {
  id: number;
  openingBalance: string;
  cashDrawerLogs?: CashDrawerLog[];
};

type Props = {
  onNotify?: (message: string, variant: "success" | "error") => void;
};

function expectedClosingBalance(shift: ShiftData): bigint {
  const opening = BigInt(shift.openingBalance);
  const logs = shift.cashDrawerLogs ?? [];

  const sumByType = (type: string) =>
    logs
      .filter((log) => log.type === type)
      .reduce((sum, log) => sum + BigInt(log.amount), 0n);

  return opening + sumByType("Sale") + sumByType("PayIn") - sumByType("PayOut");
}

export function ShiftBanner({ onNotify }: Props) {
  const queryClient = useQueryClient();
  const terminalId = useShiftStore((s) => s.terminalId);
  const shiftId = useShiftStore((s) => s.shiftId);
  const setShift = useShiftStore((s) => s.setShift);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: shift, refetch } = useQuery({
    queryKey: ["shift", terminalId],
    queryFn: () =>
      apiFetch<ShiftData | null>(`/api/shifts?terminalId=${terminalId}`),
  });

  useEffect(() => {
    setShift(shift?.id ?? null);
  }, [shift, setShift]);

  async function openShift() {
    setOpening(true);
    try {
      const created = await apiFetch<{ id: number }>("/api/shifts", {
        method: "POST",
        body: JSON.stringify({
          action: "open",
          terminalId,
          openingBalance: "0",
        }),
      });
      setShift(created.id);
      await refetch();
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : "Failed to open shift",
        "error",
      );
    } finally {
      setOpening(false);
    }
  }

  async function closeShift() {
    if (!shiftId || !shift) return;

    const confirmed = window.confirm(
      "Are you sure you want to close this shift?",
    );
    if (!confirmed) return;

    setClosing(true);
    try {
      const closingBalance = expectedClosingBalance(shift).toString();

      await apiFetch("/api/shifts", {
        method: "POST",
        body: JSON.stringify({
          action: "close",
          shiftId,
          closingBalance,
        }),
      });

      setShift(null);
      await queryClient.invalidateQueries({ queryKey: ["shift", terminalId] });
      await refetch();
      onNotify?.("Shift closed successfully", "success");
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : "Failed to close shift",
        "error",
      );
    } finally {
      setClosing(false);
    }
  }

  if (shiftId) {
    return (
      <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <span>
          Shift open on Lane {terminalId} · Shift #{shiftId}
        </span>
        <button
          type="button"
          onClick={closeShift}
          disabled={closing}
          className="rounded-md border border-emerald-700 bg-white px-3 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
        >
          {closing ? "Closing…" : "Close shift"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>No open shift — checkout requires a shift</span>
      <button
        type="button"
        onClick={openShift}
        disabled={opening}
        className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {opening ? "Opening…" : "Open shift"}
      </button>
    </div>
  );
}
