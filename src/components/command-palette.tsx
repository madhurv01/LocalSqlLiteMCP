"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actions: PaletteAction[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? actions.filter(
          (a) =>
            a.label.toLowerCase().includes(term) || a.group.toLowerCase().includes(term),
        )
      : actions;
    return list;
  }, [q, actions]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const groups = useMemo(() => {
    const m = new Map<string, PaletteAction[]>();
    for (const a of filtered) {
      if (!m.has(a.group)) m.set(a.group, []);
      m.get(a.group)!.push(a);
    }
    return [...m.entries()];
  }, [filtered]);

  const flatIndex = (a: PaletteAction) => filtered.indexOf(a);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const a = filtered[active];
                if (a) {
                  onOpenChange(false);
                  a.run();
                }
              }
            }}
            placeholder="Type a command…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <div className="scrollbar-thin max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matching commands.</p>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              {items.map((a) => {
                const idx = flatIndex(a);
                const Icon = a.icon ?? Command;
                return (
                  <button
                    key={a.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      onOpenChange(false);
                      a.run();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.label}</span>
                    {a.hint && (
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{a.hint}</span>
                    )}
                    {idx === active && <CornerDownLeft className="h-3 w-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
