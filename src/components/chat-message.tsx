"use client";

import { Bot, Sparkles, User } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentTurn } from "@/lib/turn";
import { ExecutionTimeline } from "@/components/execution-timeline";
import { PlanCard } from "@/components/plan-card";
import { SqlViewer } from "@/components/sql-viewer";
import { cn } from "@/lib/utils";

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {content}
      </div>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary">
        <User className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

export function AssistantMessage({
  turn,
  content,
  busy,
  onConfirm,
  onCancel,
  onUndo,
  suggestions,
  onSuggestion,
}: {
  turn: AgentTurn | null;
  content?: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
  suggestions?: string[];
  onSuggestion?: (text: string) => void;
}) {
  // Show streamed SQL only before the full plan card takes over.
  const showDrafts =
    turn && turn.draftSql.filter(Boolean).length > 0 && (!turn.plan || turn.status === "streaming");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2"
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {turn?.reasoning ? (
          <div className="whitespace-pre-wrap rounded-lg rounded-tl-sm bg-muted/60 px-3 py-2 text-sm">
            {turn.reasoning}
            {turn.status === "streaming" && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/70 align-middle" />
            )}
          </div>
        ) : content ? (
          <div className="whitespace-pre-wrap rounded-lg rounded-tl-sm bg-muted/60 px-3 py-2 text-sm">
            {content}
          </div>
        ) : null}

        {turn && turn.stages.length > 0 && <ExecutionTimeline events={turn.stages} />}

        <AnimatePresence>
          {showDrafts && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Drafting SQL…
              </p>
              {turn!.draftSql.filter(Boolean).map((sql, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                  <SqlViewer sql={sql} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {turn?.plan && turn.plan.statements.length > 0 && (
          <PlanCard
            turn={turn}
            busy={busy}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onUndo={onUndo}
          />
        )}

        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => onSuggestion?.(s)}
                className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {s}
              </button>
            ))}
          </div>
        )}

        {turn?.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <p className="font-medium text-destructive">{turn.error.message}</p>
            {turn.error.hint && (
              <p className="mt-1 text-xs text-muted-foreground">{turn.error.hint}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
