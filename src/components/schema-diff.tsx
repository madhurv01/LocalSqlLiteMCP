"use client";

import { ArrowRight, Minus, Plus } from "lucide-react";
import type { SchemaDiff } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SchemaDiffView({ diff, className }: { diff: SchemaDiff; className?: string }) {
  const empty =
    !diff.addedTables.length && !diff.removedTables.length && !diff.changedTables.length;
  if (empty) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No schema changes.</p>;
  }
  return (
    <div className={cn("space-y-1.5 text-xs", className)}>
      {diff.addedTables.map((t) => (
        <div key={t} className="flex items-center gap-1.5 text-success">
          <Plus className="h-3 w-3" /> table <span className="font-mono font-semibold">{t}</span>
        </div>
      ))}
      {diff.removedTables.map((t) => (
        <div key={t} className="flex items-center gap-1.5 text-destructive">
          <Minus className="h-3 w-3" /> table <span className="font-mono font-semibold">{t}</span>
        </div>
      ))}
      {diff.changedTables.map((c) => (
        <div key={c.name} className="rounded border bg-muted/30 px-2 py-1">
          <span className="font-mono font-semibold">{c.name}</span>
          {c.rowCountBefore !== c.rowCountAfter && (
            <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
              {c.rowCountBefore} <ArrowRight className="h-3 w-3" /> {c.rowCountAfter} rows
            </span>
          )}
          {c.addedColumns.map((col) => (
            <span key={col} className="ml-2 text-success">
              +{col}
            </span>
          ))}
          {c.removedColumns.map((col) => (
            <span key={col} className="ml-2 text-destructive">
              −{col}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
