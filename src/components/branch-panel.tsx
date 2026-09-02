"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  GitBranch,
  GitFork,
  GitMerge,
  Loader2,
  Trash2,
} from "lucide-react";
import type { BranchComparison, BranchView, PreviewResult } from "@/lib/types";
import { Button } from "@/components/ui/primitives";
import { SchemaDiffView } from "@/components/schema-diff";
import { jsonFetch } from "@/lib/client-api";
import { cn, relativeTime } from "@/lib/utils";

export function BranchPanel({
  databaseId,
  branches,
  busy,
  onSwitch,
  onCreate,
  onDiscard,
  onMerged,
}: {
  databaseId: string | null;
  branches: BranchView[];
  busy: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDiscard: (id: string) => void;
  onMerged: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Record<string, BranchComparison>>({});
  const [mergePreview, setMergePreview] = useState<Record<string, PreviewResult | null>>({});
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function toggle(id: string) {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (!cmp[id] && databaseId) {
      try {
        const r = await jsonFetch<{ comparison: BranchComparison }>(
          `/api/databases/${databaseId}/branches/${id}/diff`,
        );
        setCmp((c) => ({ ...c, [id]: r.comparison }));
      } catch {
        /* ignore */
      }
    }
  }

  async function previewMerge(id: string) {
    if (!databaseId) return;
    setLocalBusy(id);
    try {
      const r = await jsonFetch<{ preview?: PreviewResult; message: string; conflict?: string }>(
        `/api/databases/${databaseId}/branches/${id}/merge`,
        { method: "POST", body: JSON.stringify({ confirm: false }) },
      );
      setMergePreview((m) => ({ ...m, [id]: r.preview ?? null }));
      if (r.conflict) alert(r.conflict);
    } finally {
      setLocalBusy(null);
    }
  }

  async function doMerge(id: string) {
    if (!databaseId) return;
    setLocalBusy(id);
    try {
      const r = await jsonFetch<{ ok: boolean; message: string }>(
        `/api/databases/${databaseId}/branches/${id}/merge`,
        { method: "POST", body: JSON.stringify({ confirm: true }) },
      );
      alert(r.message);
      onMerged();
    } finally {
      setLocalBusy(null);
      setMergePreview((m) => ({ ...m, [id]: null }));
      setExpanded(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Branches · {branches.length}
        </span>
      </div>

      <div className="px-2 pb-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) {
              onCreate(newName.trim());
              setNewName("");
            }
          }}
          className="flex gap-1"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="fork current branch as…"
            className="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !newName.trim()}>
            <GitFork className="h-3.5 w-3.5" /> Fork
          </Button>
        </form>
      </div>

      <motion.div layout className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
        <AnimatePresence initial={false}>
          {branches.map((b) => {
            const comparison = cmp[b.id];
            const preview = mergePreview[b.id];
            const isOpen = expanded === b.id;
            return (
              <motion.div
                key={b.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                className={cn(
                  "overflow-hidden rounded-lg border",
                  b.isActive ? "border-primary/40 bg-primary/[0.04]" : "bg-card",
                )}
              >
                <div className="flex items-center gap-2 px-2.5 py-2">
                  {b.isMain ? (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <GitFork className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{b.name}</span>
                      {b.isActive && (
                        <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">
                          checked out
                        </span>
                      )}
                      {b.status === "merged" && (
                        <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                          merged
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {b.tableCount} tables · {b.rowCount} rows
                      {!b.isMain && ` · ${b.aheadBy} op ahead`} · {relativeTime(b.createdAt)}
                    </p>
                  </div>
                  {!b.isActive && b.exists && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={busy}
                      onClick={() => onSwitch(b.id)}
                    >
                      Switch
                    </Button>
                  )}
                </div>

                {!b.isMain && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/30 px-2.5 py-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => toggle(b.id)}
                    >
                      {isOpen ? "Hide diff" : "Compare"}
                    </Button>
                    {b.status !== "merged" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={localBusy === b.id}
                        onClick={() => (preview ? doMerge(b.id) : previewMerge(b.id))}
                      >
                        {localBusy === b.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <GitMerge className="h-3.5 w-3.5" />
                        )}
                        {preview ? "Confirm merge" : "Merge to parent"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => onDiscard(b.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Discard
                    </Button>
                  </div>
                )}

                <AnimatePresence>
                  {isOpen && comparison && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t px-2.5 py-2"
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {comparison.branch} vs {comparison.parent}
                      </p>
                      <SchemaDiffView diff={comparison.schemaDiff} className="mb-1.5" />
                      {comparison.rowDeltas.map((d, i) => (
                        <motion.div
                          key={d.table}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="flex items-center gap-1.5 text-[11px]"
                        >
                          <span className="font-mono font-semibold">{d.table}</span>
                          <span className="text-muted-foreground">
                            {d.parent} <ArrowRight className="inline h-3 w-3" /> {d.branch}
                          </span>
                          <span className={d.branch >= d.parent ? "text-success" : "text-destructive"}>
                            ({d.branch >= d.parent ? "+" : ""}
                            {d.branch - d.parent})
                          </span>
                        </motion.div>
                      ))}
                      {comparison.operations.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {comparison.operations.map((o) => (
                            <div key={o.id} className="flex items-center gap-1.5 text-[11px]">
                              <Check className="h-3 w-3 text-success" />
                              <span className="truncate">{o.intent}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!comparison.schemaDiff.addedTables.length &&
                        !comparison.schemaDiff.removedTables.length &&
                        !comparison.schemaDiff.changedTables.length &&
                        !comparison.rowDeltas.length && (
                          <p className="text-[11px] text-muted-foreground">
                            Identical to {comparison.parent}.
                          </p>
                        )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
