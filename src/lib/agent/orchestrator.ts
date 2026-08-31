import { nanoid } from "nanoid";
import type {
  AgentEvent,
  AgentPlan,
  ExecutionResult,
  PipelineStage,
  PreviewResult,
  SchemaSnapshot,
  VerificationResult,
} from "@/lib/types";
import { LocalMcpClient } from "@/lib/mcp/client";
import { resolveProvider } from "@/lib/agent/providers";
import { assessScript, splitStatements } from "@/lib/sqlite/safety";
import { diffSchemas } from "@/lib/sqlite/diff";
import { repo } from "@/lib/repo";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

function stage(
  stage: PipelineStage,
  status: "start" | "progress" | "done" | "blocked" | "error",
  title: string,
  detail?: string,
  data?: unknown,
): AgentEvent {
  return { type: "stage", stage, status, title, detail, data, at: new Date().toISOString() };
}

function fmtBytes(n: number): string {
  if (!n) return "new";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function impactLine(p: PreviewResult): string {
  const parts: string[] = [];
  const d = p.schemaDiff;
  const tableChanges = d.addedTables.length + d.removedTables.length + d.changedTables.length;
  if (tableChanges) parts.push(`${tableChanges} table${tableChanges > 1 ? "s" : ""} changed`);
  const added = p.rowDeltas.reduce((s, r) => s + Math.max(0, r.after - r.before), 0);
  const removed = p.rowDeltas.reduce((s, r) => s + Math.max(0, r.before - r.after), 0);
  if (added || removed) parts.push(`+${added} −${removed} rows`);
  if (p.verifications.length) {
    const passed = p.verifications.filter((v) => v.passed).length;
    parts.push(`checks ${passed}/${p.verifications.length}`);
  }
  if (!parts.length) parts.push("no changes");
  return parts.join(" · ");
}

export interface OrchestratorInput {
  databaseId: string;
  databasePath: string;
  conversationId: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}

/**
 * Run the full Understand → Inspect → Plan → Safety → Preview → Execute →
 * Verify → Complete pipeline, yielding events for the SSE stream.
 *
 * If the plan needs confirmation, the pipeline stops after Preview and
 * persists an `awaiting_confirmation` operation. The client then POSTs a
 * confirmation which calls `executeOperation`.
 */
export async function* runPipeline(input: OrchestratorInput): AsyncGenerator<AgentEvent> {
  const mcp = new LocalMcpClient();
  const flatStatements = (plan: AgentPlan) => plan.statements.map((s) => s.sql);

  try {
    // 1. UNDERSTAND ------------------------------------------------------
    yield stage("understand", "start", "Understanding request");
    yield stage("understand", "done", "Understood", input.message);

    // 2. INSPECT -------------------------------------------------------
    yield stage("inspect", "start", "Inspecting database");
    const before = mcp.invoke<SchemaSnapshot>("schema_snapshot", {
      databasePath: input.databasePath,
    });
    yield stage(
      "inspect",
      "done",
      `Found ${before.tables.length} table(s)`,
      before.tables.map((t) => `${t.name} (${t.rowCount})`).join(", ") || "empty database",
      before,
    );

    // 3. PLAN --------------------------------------------------------
    yield stage("plan", "start", "Planning operation");
    const { provider, fellBack } = await resolveProvider();
    if (fellBack) {
      yield stage(
        "plan",
        "progress",
        "Configured LLM unavailable — using offline planner",
        `LLM_PROVIDER=${config.llmProvider} not reachable`,
      );
    }

    const eventQueue: AgentEvent[] = [];
    let notify: (() => void) | null = null;
    let draftCount = 0;
    const push = (e: AgentEvent) => {
      eventQueue.push(e);
      notify?.();
    };

    let plan: AgentPlan | undefined;
    let planErr: unknown;
    const planPromise = (async () => {
      try {
        plan = await provider.plan(
          { message: input.message, schema: before, history: input.history },
          {
            onToken: (t) => push({ type: "token", text: t }),
            onStatement: (sql, index) => {
              draftCount = Math.max(draftCount, index + 1);
              push({ type: "sql", index, text: sql });
            },
          },
        );
      } catch (err) {
        planErr = err;
      }
    })();

    // Interleave: emit reasoning tokens + drafted SQL as they arrive.
    let settled = false;
    planPromise.then(() => {
      settled = true;
      notify?.();
    });
    while (!settled || eventQueue.length) {
      if (!eventQueue.length) {
        await new Promise<void>((r) => {
          notify = r;
          if (settled || eventQueue.length) r();
        });
        notify = null;
        continue;
      }
      yield eventQueue.shift()!;
    }

    if (planErr || !plan) {
      const heur = (await import("./providers")).heuristicProvider;
      logger.warn("primary planner failed, retrying with heuristic", { err: String(planErr) });
      yield stage("plan", "progress", "Planner error — retrying with offline planner");
      plan = await heur.plan({ message: input.message, schema: before, history: input.history });
    }

    // Providers that don't stream SQL (heuristic) — emit drafts from the result.
    if (draftCount === 0) {
      for (let i = 0; i < plan.statements.length; i++) {
        yield { type: "sql", index: i, text: plan.statements[i].sql };
      }
    }

    yield stage("plan", "done", plan.summary || "Plan ready", plan.intent, {
      provider: provider.name,
      plan,
    });

    if (!plan.statements.length) {
      yield stage("complete", "done", "No executable statements", plan.summary);
      yield {
        type: "done",
        operationId: null,
        awaitingConfirmation: false,
        plan,
      };
      return;
    }

    // 4. SAFETY CHECK ---------------------------------------------
    yield stage("safety", "start", "Running safety checks");
    const report = assessScript(flatStatements(plan));
    if (!report.ok) {
      yield stage("safety", "blocked", "Operation blocked", report.blocked.join("; "));
      yield { type: "error", message: "Refused: contains disallowed statements.", hint: report.blocked.join("; ") };
      return;
    }
    yield stage(
      "safety",
      "done",
      `Risk: ${report.risk.toUpperCase()}`,
      report.warnings.join(" ") ||
        (report.destructiveStatements > 0
          ? `${report.destructiveStatements} destructive statement(s) — reversible via snapshot`
          : "No destructive statements"),
      { risk: report.risk, warnings: report.warnings, destructiveStatements: report.destructiveStatements },
    );

    // 5. PREVIEW (sandbox) -------------------------------------
    yield stage("preview", "start", "Cloning database into a sandbox");
    const preview = mcp.invoke<PreviewResult>("preview", {
      databasePath: input.databasePath,
      sql: flatStatements(plan).join(";\n"),
      sampleRows: config.sandboxSampleRows,
      verifications: plan.verifications,
    });

    if (preview.mode === "static") {
      yield stage(
        "preview",
        "progress",
        "Sandbox skipped — static analysis only",
        preview.skippedReason,
      );
    } else {
      yield stage(
        "preview",
        "progress",
        `Ran ${preview.statements.length} statement(s) on a ${fmtBytes(preview.cloneBytes)} copy`,
        preview.nonDeterministic
          ? "Plan uses RANDOM()/CURRENT_TIMESTAMP — applied values may differ."
          : undefined,
      );
    }

    if (!preview.ok) {
      const opId = repo.createOperation({
        databaseId: input.databaseId,
        conversationId: input.conversationId,
        intent: plan.intent,
        plan,
        schemaBefore: before,
        status: "planned",
        preview,
      });
      repo.finishOperation(opId, "failed");
      yield stage("preview", "error", "Preview failed — the operation would not succeed", preview.error);
      yield {
        type: "error",
        message: preview.error ?? "The plan failed in the sandbox.",
        hint: "Caught on a throwaway copy — your database is untouched.",
      };
      yield { type: "done", operationId: opId, awaitingConfirmation: false, plan, preview };
      return;
    }

    yield stage("preview", "done", impactLine(preview), undefined, {
      preview,
      statements: plan.statements,
      verifications: plan.verifications,
    });

    const mutates =
      preview.rowDeltas.length > 0 ||
      preview.schemaDiff.addedTables.length > 0 ||
      preview.schemaDiff.removedTables.length > 0 ||
      preview.schemaDiff.changedTables.length > 0 ||
      plan.statements.some((s) => s.kind !== "read" && s.kind !== "pragma");
    const needsConfirm =
      plan.requiresConfirmation ||
      report.requiresConfirmation ||
      (config.requireConfirmAll && mutates);

    // 6. CONFIRM (gate) ---------------------------------------
    if (needsConfirm) {
      const opId = repo.createOperation({
        databaseId: input.databaseId,
        conversationId: input.conversationId,
        intent: plan.intent,
        plan,
        schemaBefore: before,
        status: "awaiting_confirmation",
        preview,
      });
      yield stage(
        "confirm",
        "blocked",
        "Confirmation required",
        `This ${report.risk} operation needs your explicit approval. ${impactLine(preview)}`,
        { operationId: opId, preview },
      );
      yield { type: "done", operationId: opId, awaitingConfirmation: true, plan, preview };
      return;
    }

    const opId = repo.createOperation({
      databaseId: input.databaseId,
      conversationId: input.conversationId,
      intent: plan.intent,
      plan,
      schemaBefore: before,
      status: "planned",
      preview,
    });

    for await (const evt of executeOperation(opId)) yield evt;
  } catch (err) {
    logger.error("pipeline crashed", { err: err instanceof Error ? err.stack : String(err) });
    yield stage("error", "error", "Pipeline error", err instanceof Error ? err.message : String(err));
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute a persisted operation (either auto for safe ops, or after the user
 * confirms a destructive one). Yields Execute → Verify → Complete events.
 */
export async function* executeOperation(operationId: string): AsyncGenerator<AgentEvent> {
  const op = repo.getOperation(operationId);
  if (!op) {
    yield { type: "error", message: `Operation ${operationId} not found.` };
    return;
  }
  const plan: AgentPlan = JSON.parse(op.plan);
  const preview: PreviewResult | null = op.previewResult ? JSON.parse(op.previewResult) : null;
  const database = repo.getDatabase(op.databaseId);
  if (!database) {
    yield { type: "error", message: "Database no longer registered." };
    return;
  }
  const mcp = new LocalMcpClient();
  const statements = plan.statements.map((s) => s.sql);
  const schemaBefore: SchemaSnapshot = op.schemaBefore
    ? JSON.parse(op.schemaBefore)
    : mcp.invoke<SchemaSnapshot>("schema_snapshot", { databasePath: database.path });

  repo.setOperationStatus(operationId, "executing");

  // 7. EXECUTE --------------------------------------------------------
  yield stage("execute", "start", "Executing in a transaction");
  let raw: (ExecutionResult & {
    snapshotFilePath?: string | null;
    schemaAfter?: SchemaSnapshot;
    schemaBefore?: SchemaSnapshot;
  }) | null = null;
  try {
    raw = mcp.invoke("execute", {
      databasePath: database.path,
      sql: statements.join(";\n"),
      confirmDestructive: true,
      snapshot: true,
      databaseId: database.id,
      operationId,
    });
  } catch (err) {
    repo.finishOperation(operationId, "failed");
    yield stage("execute", "error", "Execution failed", err instanceof Error ? err.message : String(err));
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      hint: "The transaction was rolled back. Your data is unchanged.",
    };
    return;
  }

  if (!raw) {
    repo.finishOperation(operationId, "failed");
    yield stage("execute", "error", "Execution produced no result");
    yield { type: "error", message: "Execution produced no result." };
    return;
  }

  if (!raw.ok) {
    repo.finishOperation(operationId, "failed", { result: raw, durationMs: raw.durationMs });
    yield stage("execute", "error", "Rolled back", raw.error);
    yield {
      type: "error",
      message: raw.error ?? "Execution failed",
      hint: "The whole batch was rolled back inside the transaction. Nothing was committed.",
    };
    return;
  }

  if (raw.snapshotId && raw.snapshotFilePath) {
    repo.recordSnapshot({
      id: raw.snapshotId,
      databaseId: database.id,
      operationId,
      filePath: raw.snapshotFilePath,
      sizeBytes: 0,
      reason: "pre-mutation",
    });
  }

  yield stage(
    "execute",
    "done",
    `Executed ${raw.statements.length} statement(s) in ${raw.durationMs}ms`,
    undefined,
    { statements: raw.statements },
  );

  // 8. VERIFY -----------------------------------------------------
  yield stage("verify", "start", "Verifying results");
  const verifications: VerificationResult[] = [];
  for (const v of plan.verifications) {
    try {
      const res = mcp.invoke<{ results: { rows?: Record<string, unknown>[] }[] }>("query", {
        databasePath: database.path,
        sql: v.sql,
        maxRows: 50,
      });
      const rows = res.results[0]?.rows ?? [];
      verifications.push({ description: v.description, sql: v.sql, passed: rows.length > 0, rows });
    } catch (err) {
      verifications.push({
        description: v.description,
        sql: v.sql,
        passed: false,
        rows: [{ error: err instanceof Error ? err.message : String(err) }],
      });
    }
  }
  const allPassed = verifications.every((v) => v.passed);
  yield stage(
    "verify",
    allPassed ? "done" : "progress",
    allPassed ? "All checks passed" : "Some checks need review",
    undefined,
    { verifications },
  );

  // 9. COMPLETE -------------------------------------------------
  const schemaAfter = raw.schemaAfter ?? mcp.invoke<SchemaSnapshot>("schema_snapshot", { databasePath: database.path });
  const schemaDiff = diffSchemas(schemaBefore, schemaAfter);

  const result: ExecutionResult = {
    operationId,
    ok: true,
    durationMs: raw.durationMs,
    statements: raw.statements,
    verifications,
    schemaDiff,
    snapshotId: raw.snapshotId,
  };

  repo.finishOperation(operationId, "completed", {
    result,
    schemaAfter,
    snapshotId: raw.snapshotId,
    durationMs: raw.durationMs,
  });
  repo.touchDatabase(database.id);

  yield stage("complete", "done", "Operation complete", undefined, { schemaDiff, result, preview });
  yield {
    type: "done",
    operationId,
    awaitingConfirmation: false,
    plan,
    preview,
    result,
  };
}

/** Roll a completed operation back using its pre-mutation snapshot. */
export function undoOperation(operationId: string): { ok: boolean; message: string } {
  const op = repo.getOperation(operationId);
  if (!op) return { ok: false, message: "Operation not found." };
  if (op.status !== "completed") {
    return { ok: false, message: `Operation is "${op.status}", only completed operations can be undone.` };
  }
  if (!op.snapshotId) return { ok: false, message: "No snapshot was taken for this operation." };
  const snap = repo.getSnapshot(op.snapshotId);
  if (!snap) return { ok: false, message: "Snapshot record missing." };
  if (snap.consumed) return { ok: false, message: "This snapshot was already used for a rollback." };

  const database = repo.getDatabase(op.databaseId);
  if (!database) return { ok: false, message: "Database not registered." };

  const mcp = new LocalMcpClient();
  mcp.invoke("restore_snapshot", {
    databasePath: database.path,
    snapshotFilePath: snap.filePath,
  });
  repo.markSnapshotConsumed(snap.id);
  repo.setOperationStatus(operationId, "rolled_back");
  logger.info("operation rolled back", { operationId });
  return { ok: true, message: `Rolled back to the snapshot from ${snap.createdAt}.` };
}
