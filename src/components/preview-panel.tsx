"use client";

import { ArrowRight, Beaker, Dice5, FlaskConical, Minus, Plus, Pencil } from "lucide-react";
import type { PreviewResult, SampleChange } from "@/lib/types";
import { DataGrid } from "@/components/data-grid";
import { SchemaDiffView } from "@/components/schema-diff";
import { cn, formatBytes, formatMs } from "@/lib/utils";

const OP_META = {
  insert: { icon: Plus, className: "text-success", label: "insert" },
  delete: { icon: Minus, className: "text-destructive", label: "delete" },
  update: { icon: Pencil, className: "text-amber-500", label: "update" },
} as const;

export function PreviewPanel({ preview, applied }: { preview: PreviewResult; applied: boolean }) {
  const isStatic = preview.mode === "static";
  const added = preview.rowDeltas.reduce((s, r) => s + Math.max(0, r.after - r.before), 0);
  const removed = preview.rowDeltas.reduce((s, r) => s + Math.max(0, r.before - r.after), 0);

  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.04]">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          {isStatic ? <Beaker className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
          {isStatic ? "Static preview" : applied ? "Sandbox preview (applied)" : "Sandbox preview"}
        </span>
        {!isStatic && (
          <span className="text-[11px] text-muted-foreground">
            ran on a {formatBytes(preview.cloneBytes)} copy · {formatMs(preview.durationMs)}
          </span>
        )}
        {preview.nonDeterministic && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
            <Dice5 className="h-3 w-3" /> non-deterministic — applied values may differ
          </span>
        )}
      </div>

      <div className="space-y-2.5 p-2.5">
        {isStatic ? (
          <p className="text-xs text-muted-foreground">{preview.skippedReason}</p>
        ) : !preview.ok ? (
          <p className="text-xs text-destructive">
            Would fail: {preview.error} — caught on the copy, real database untouched.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-success">+{added} rows</span>
              <span className="text-destructive">−{removed} rows</span>
              {preview.verifications.length > 0 && (
                <span className="text-muted-foreground">
                  checks {preview.verifications.filter((v) => v.passed).length}/
                  {preview.verifications.length} passed
                </span>
              )}
            </div>

            {preview.rowDeltas.length > 0 && (
              <div className="space-y-0.5">
                {preview.rowDeltas.map((r) => (
                  <div key={r.table} className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-mono font-semibold">{r.table}</span>
                    <span className="text-muted-foreground">
                      {r.before} <ArrowRight className="inline h-3 w-3" /> {r.after}
                    </span>
                    <span
                      className={cn(
                        r.after > r.before ? "text-success" : "text-destructive",
                      )}
                    >
                      ({r.after > r.before ? "+" : ""}
                      {r.after - r.before})
                    </span>
                  </div>
                ))}
              </div>
            )}

            <SchemaDiffView diff={preview.schemaDiff} />

            {preview.sampleChanges.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Sample changes ({preview.sampleChanges.length})
                </p>
                <div className="space-y-1.5">
                  {preview.sampleChanges.map((c, i) => (
                    <SampleRow key={i} change={c} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SampleRow({ change }: { change: SampleChange }) {
  const meta = OP_META[change.op];
  const Icon = meta.icon;
  return (
    <div className="rounded border bg-background/60 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase">
        <Icon className={cn("h-3 w-3", meta.className)} />
        <span className={meta.className}>{meta.label}</span>
        <span className="font-mono text-muted-foreground">{change.table}</span>
      </div>
      {change.op === "update" ? (
        <div className="grid gap-1 sm:grid-cols-2">
          <DataGrid rows={change.before ? [change.before] : []} emptyLabel="—" />
          <DataGrid rows={change.after ? [change.after] : []} emptyLabel="—" />
        </div>
      ) : (
        <DataGrid rows={[(change.after ?? change.before) as Record<string, unknown>]} />
      )}
    </div>
  );
}
