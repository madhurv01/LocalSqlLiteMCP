"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleDashed,
  Database,
  FileSearch,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { StageEvent, PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGES: { key: PipelineStage; label: string; icon: typeof Brain }[] = [
  { key: "understand", label: "Understand", icon: Brain },
  { key: "inspect", label: "Inspect", icon: FileSearch },
  { key: "plan", label: "Plan", icon: Sparkles },
  { key: "safety", label: "Safety Check", icon: ShieldCheck },
  { key: "preview", label: "Preview", icon: Database },
  { key: "confirm", label: "Confirm", icon: AlertTriangle },
  { key: "execute", label: "Execute", icon: Play },
  { key: "verify", label: "Verify", icon: CheckCircle2 },
  { key: "complete", label: "Complete", icon: Sparkles },
];

export function ExecutionTimeline({ events }: { events: StageEvent[] }) {
  const latestByStage = new Map<PipelineStage, StageEvent>();
  for (const e of events) latestByStage.set(e.stage, e);

  const activeIndex = STAGES.findIndex((s) => {
    const ev = latestByStage.get(s.key);
    return ev && ev.status !== "done";
  });

  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Loader2 className={cn("h-3.5 w-3.5", activeIndex >= 0 && "animate-spin")} />
        Execution timeline
      </div>
      <ol className="space-y-1.5">
        {STAGES.map((stage, i) => {
          const ev = latestByStage.get(stage.key);
          if (!ev && stage.key === "confirm") return null;
          const Icon = stage.icon;
          const state = !ev
            ? i === activeIndex + 0 && activeIndex === -1
              ? "pending"
              : "pending"
            : ev.status === "done"
              ? "done"
              : ev.status === "error"
                ? "error"
                : ev.status === "blocked"
                  ? "blocked"
                  : "active";
          return (
            <motion.li
              key={stage.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: ev ? 1 : 0.4, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.02 }}
              className="flex items-start gap-2.5"
            >
              <div
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  state === "done" && "border-success/40 bg-success/10 text-success",
                  state === "active" && "border-primary/40 bg-primary/10 text-primary",
                  state === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                  state === "blocked" && "border-warning/50 bg-warning/10 text-warning",
                  state === "pending" && "text-muted-foreground",
                )}
              >
                {state === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : state === "error" ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : state === "blocked" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : state === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : state === "pending" ? (
                  <CircleDashed className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      state === "pending" && "text-muted-foreground",
                    )}
                  >
                    {ev?.title || stage.label}
                  </span>
                </div>
                <AnimatePresence>
                  {ev?.detail && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-0.5 break-words text-xs text-muted-foreground"
                    >
                      {ev.detail}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
