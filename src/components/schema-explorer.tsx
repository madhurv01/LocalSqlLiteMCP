"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, KeyRound, Table2, Link2, RefreshCw } from "lucide-react";
import type { SchemaSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

export function SchemaExplorer({
  schema,
  onRefresh,
  refreshing,
}: {
  schema: SchemaSnapshot | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Schema {schema ? `· ${schema.tables.length}` : ""}
        </span>
        {onRefresh && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRefresh}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        )}
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {!schema?.tables.length && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No tables yet. Ask the agent to create one.
          </p>
        )}
        {schema?.tables.map((t) => {
          const isOpen = open === t.name;
          return (
            <div key={t.name} className="mb-0.5">
              <button
                onClick={() => setOpen(isOpen ? null : t.name)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
              >
                <ChevronRight
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")}
                />
                <Table2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate font-medium">{t.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {t.type === "view" ? "view" : `${t.rowCount} rows`}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pl-7 pr-2"
                  >
                    {t.columns.map((c) => (
                      <li
                        key={c.name}
                        className="flex items-center gap-1.5 py-0.5 text-xs"
                      >
                        {c.primaryKey && <KeyRound className="h-3 w-3 text-amber-500" />}
                        {t.foreignKeys.some((fk) => fk.column === c.name) && (
                          <Link2 className="h-3 w-3 text-sky-500" />
                        )}
                        <span className="font-mono">{c.name}</span>
                        <span className="text-muted-foreground">{c.type || "—"}</span>
                        {c.notNull && <span className="text-[10px] text-muted-foreground">NN</span>}
                      </li>
                    ))}
                    {t.indexes.length > 0 && (
                      <li className="mt-1 text-[10px] uppercase text-muted-foreground">
                        {t.indexes.length} index(es)
                      </li>
                    )}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
