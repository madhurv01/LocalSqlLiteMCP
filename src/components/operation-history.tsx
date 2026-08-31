"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { RiskBadge } from "@/components/risk-badge";
import { formatMs, relativeTime, cn } from "@/lib/utils";

export interface OperationSummary {
  id: string;
  status: string;
  intent: string;
  risk: string;
  durationMs: number | null;
  createdAt: string;
  snapshotId: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  completed: "text-success",
  failed: "text-destructive",
  rolled_back: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  awaiting_confirmation: "text-warning",
  executing: "text-primary",
  planned: "text-muted-foreground",
};

export function OperationHistory({
  operations,
  onUndo,
  busy,
}: {
  operations: OperationSummary[];
  onUndo: (id: string) => void;
  busy: boolean;
}) {
  if (!operations.length) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">No operations yet.</p>;
  }
  return (
    <ul className="scrollbar-thin space-y-1 overflow-y-auto px-2 pb-2">
      {operations.map((op) => (
        <li key={op.id} className="rounded-md border px-2.5 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className={cn("font-semibold capitalize", STATUS_STYLE[op.status])}>
              {op.status.replace(/_/g, " ")}
            </span>
            <span className="ml-auto text-muted-foreground">{relativeTime(op.createdAt)}</span>
          </div>
          <p className="mt-0.5 truncate text-foreground">{op.intent}</p>
          <div className="mt-1 flex items-center gap-2">
            <RiskBadge risk={op.risk} />
            <span className="text-muted-foreground">{formatMs(op.durationMs)}</span>
            {op.status === "completed" && op.snapshotId && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-1.5"
                disabled={busy}
                onClick={() => onUndo(op.id)}
              >
                <RotateCcw className="h-3 w-3" /> undo
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
