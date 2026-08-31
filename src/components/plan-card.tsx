"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import type { AgentTurn } from "@/lib/turn";
import { Button, Card, Separator } from "@/components/ui/primitives";
import { SqlViewer } from "@/components/sql-viewer";
import { RiskBadge } from "@/components/risk-badge";
import { DataGrid } from "@/components/data-grid";
import { SchemaDiffView } from "@/components/schema-diff";
import { PreviewPanel } from "@/components/preview-panel";
import { formatMs } from "@/lib/utils";

export function PlanCard({
  turn,
  busy,
  onConfirm,
  onCancel,
  onUndo,
}: {
  turn: AgentTurn;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const plan = turn.plan;
  if (!plan || !plan.statements.length) return null;
  const result = turn.result;
  const awaiting = turn.status === "awaiting_confirmation";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Execution plan
          </span>
          <RiskBadge risk={plan.risk} />
          {plan.requiresConfirmation && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
              <ShieldAlert className="h-3 w-3" /> confirmation required
            </span>
          )}
          {result && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatMs(result.durationMs)}
            </span>
          )}
        </div>

        <div className="space-y-3 p-3">
          {plan.statements.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono uppercase">
                  {s.kind}
                </span>
                <span>{s.rationale}</span>
              </div>
              <SqlViewer sql={s.sql} />
              {result?.statements[i] && (
                <div className="flex flex-wrap items-center gap-3 pl-1 text-[11px] text-muted-foreground">
                  {result.statements[i].error ? (
                    <span className="text-destructive">✗ {result.statements[i].error}</span>
                  ) : (
                    <>
                      <span className="text-success">
                        ✓ {result.statements[i].rowsAffected} row(s) affected
                      </span>
                      <span>{formatMs(result.statements[i].durationMs)}</span>
                    </>
                  )}
                  {result.statements[i].rows?.length ? (
                    <div className="w-full pt-1">
                      <DataGrid
                        rows={result.statements[i].rows!}
                        columns={result.statements[i].columns}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {turn.dryRun?.affectedTables?.length ? (
            <p className="text-[11px] text-muted-foreground">
              Affected tables:{" "}
              <span className="font-mono">{turn.dryRun.affectedTables.join(", ")}</span>
            </p>
          ) : null}

          {plan.notes.length > 0 && (
            <ul className="space-y-0.5">
              {plan.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {n}
                </li>
              ))}
            </ul>
          )}

          {plan.verifications.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Verification
                </p>
                <div className="space-y-1">
                  {plan.verifications.map((v, i) => {
                    const vr = result?.verifications[i] ?? turn.preview?.verifications[i];
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {vr ? (
                          vr.passed ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          )
                        ) : (
                          <span className="h-3.5 w-3.5 rounded-full border" />
                        )}
                        <span>{v.description}</span>
                        {vr?.rows?.[0] && (
                          <span className="font-mono text-muted-foreground">
                            → {JSON.stringify(vr.rows[0])}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {turn.preview && (
            <>
              <Separator />
              <PreviewPanel preview={turn.preview} applied={!!result?.ok} />
            </>
          )}

          {result && (
            <>
              <Separator />
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Schema diff
                </p>
                <SchemaDiffView diff={result.schemaDiff} />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2">
          {awaiting && (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={onConfirm}>
                <Play className="h-3.5 w-3.5" /> Apply to database
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {turn.preview?.mode === "sandbox"
                  ? "You're seeing the real result from a throwaway copy. Applying re-runs it on your database with a snapshot for undo."
                  : "A snapshot will be taken before execution — you can undo afterwards."}
              </span>
            </>
          )}
          {turn.status === "done" && result?.ok && turn.operationId && result.snapshotId && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onUndo}>
              <RotateCcw className="h-3.5 w-3.5" /> Undo / rollback
            </Button>
          )}
          {turn.status === "done" && result?.ok && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> committed &amp; verified
            </span>
          )}
          {turn.status === "cancelled" && (
            <span className="text-[11px] text-muted-foreground">Cancelled — nothing executed.</span>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
