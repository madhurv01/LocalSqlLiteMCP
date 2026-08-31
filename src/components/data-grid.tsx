"use client";

import { cn } from "@/lib/utils";

export function DataGrid({
  rows,
  columns,
  className,
  emptyLabel = "No rows",
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
  className?: string;
  emptyLabel?: string;
}) {
  const cols = columns?.length ? columns : rows.length ? Object.keys(rows[0]) : [];
  if (!rows.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className={cn("scrollbar-thin max-h-64 overflow-auto rounded-md border", className)}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b px-2.5 py-1.5 text-left font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-muted/20">
              {cols.map((c) => (
                <td key={c} className="border-b px-2.5 py-1.5 align-top font-mono">
                  {fmt(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
