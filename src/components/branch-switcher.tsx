"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, GitBranch, GitFork, Loader2, Plus } from "lucide-react";
import type { BranchView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BranchSwitcher({
  branches,
  busy,
  onSwitch,
  onCreate,
}: {
  branches: BranchView[];
  busy: boolean;
  onSwitch: (branchId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const active = branches.find((b) => b.isActive);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!branches.length) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
          active?.isMain
            ? "border-border bg-secondary text-secondary-foreground"
            : "border-primary/40 bg-primary/10 text-primary",
          "hover:bg-accent",
        )}
      >
        <motion.span
          key={active?.id}
          initial={{ rotate: -30, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <GitBranch className="h-3.5 w-3.5" />
        </motion.span>
        <span className="max-w-[140px] truncate">{active?.name ?? "main"}</span>
        {!active?.isMain && active && (
          <span className="rounded-full bg-primary/20 px-1 text-[10px]">+{active.aheadBy}</span>
        )}
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 z-50 mt-1.5 w-72 origin-top-right overflow-hidden rounded-lg border bg-card shadow-xl"
          >
            <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Branches
            </div>
            <motion.ul layout className="max-h-64 overflow-y-auto p-1">
              {branches.map((b) => (
                <motion.li key={b.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <button
                    disabled={busy || b.isActive || !b.exists}
                    onClick={() => {
                      setOpen(false);
                      onSwitch(b.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      b.isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    {b.isMain ? (
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <GitFork className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {b.tableCount}t · {b.rowCount}r
                      {b.status === "merged" && " · merged"}
                    </span>
                    {b.isActive && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
                  </button>
                </motion.li>
              ))}
            </motion.ul>

            <div className="border-t p-1">
              <AnimatePresence mode="wait" initial={false}>
                {creating ? (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (name.trim()) {
                        onCreate(name.trim());
                        setName("");
                        setCreating(false);
                        setOpen(false);
                      }
                    }}
                    className="flex gap-1 p-1"
                  >
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="branch name"
                      className="h-7 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground"
                    >
                      Fork
                    </button>
                  </motion.form>
                ) : (
                  <motion.button
                    key="btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                  >
                    <Plus className="h-3.5 w-3.5" /> New branch from{" "}
                    <span className="font-medium">{active?.name}</span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
