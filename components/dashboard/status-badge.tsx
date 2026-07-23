import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  Open: "bg-blue-100 text-blue-800",
  PartiallyPaid: "bg-amber-100 text-amber-900",
  Packed: "bg-violet-100 text-violet-800",
  OutForDelivery: "bg-cyan-100 text-cyan-800",
  Delivered: "bg-emerald-100 text-emerald-800",
  Closed: "bg-emerald-100 text-emerald-800",
  Void: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status.replaceAll(/([a-z])([A-Z])/g, "$1 $2")}
    </span>
  );
}
