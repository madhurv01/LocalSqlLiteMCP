"use client";

import { cn, RISK_META } from "@/lib/utils";

export function RiskBadge({ risk, className }: { risk: string; className?: string }) {
  const meta = RISK_META[risk] ?? RISK_META.low;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        meta.className,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label} risk
    </span>
  );
}
