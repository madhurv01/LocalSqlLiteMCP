/**
 * Canonical database capability layer. Both the in-process agent and the
 * standalone stdio MCP server call these functions, so external MCP clients
 * get exactly the same safety guarantees as the app.
 */
import { z } from "zod";
import { openUserDb, closeUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema, describeTable, listTables } from "@/lib/sqlite/introspect";
import { diffSchemas } from "@/lib/sqlite/diff";
import { runInTransaction, runStatement, affectedTables } from "@/lib/sqlite/executor";
import { assessScript, splitStatements } from "@/lib/sqlite/safety";
import { createSnapshot, restoreSnapshot } from "@/lib/sqlite/snapshot";
import { runInSandbox } from "@/lib/sqlite/sandbox";
import { resolveDbPath } from "@/lib/sqlite/path-safety";
import { logger } from "@/lib/logger";
import type { ExecutionResult } from "@/lib/types";
import { nanoid } from "nanoid";

export const toolInput = {
  list_tables: z.object({ databasePath: z.string() }),
  describe_table: z.object({ databasePath: z.string(), table: z.string() }),
  schema_snapshot: z.object({ databasePath: z.string() }),
  query: z.object({
    databasePath: z.string(),
    sql: z.string(),
    params: z.array(z.any()).optional(),
    maxRows: z.number().int().positive().max(5000).optional(),
  }),
  dry_run: z.object({ databasePath: z.string(), sql: z.string() }),
  preview: z.object({
    databasePath: z.string(),
    sql: z.string(),
    sampleRows: z.number().int().positive().max(200).optional(),
    verifications: z
      .array(z.object({ description: z.string(), sql: z.string() }))
      .optional(),
  }),
  execute: z.object({
    databasePath: z.string(),
    sql: z.string(),
    confirmDestructive: z.boolean().default(false),
    snapshot: z.boolean().default(true),
    databaseId: z.string().optional(),
    operationId: z.string().optional(),
  }),
  restore_snapshot: z.object({ databasePath: z.string(), snapshotFilePath: z.string() }),
};

export function tool_list_tables(args: z.infer<typeof toolInput.list_tables>) {
  const db = openUserDb(args.databasePath, { readonly: true });
  return { tables: listTables(db) };
}

export function tool_describe_table(args: z.infer<typeof toolInput.describe_table>) {
  const db = openUserDb(args.databasePath, { readonly: true });
  return describeTable(db, args.table, "table");
}

export function tool_schema_snapshot(args: z.infer<typeof toolInput.schema_snapshot>) {
  const db = openUserDb(args.databasePath, { readonly: true });
  return captureSchema(db);
}

export function tool_query(args: z.infer<typeof toolInput.query>) {
  const statements = splitStatements(args.sql);
  const report = assessScript(statements);
  const nonRead = report.perStatement.filter((s) => s.kind !== "read" && s.kind !== "pragma");
  if (nonRead.length) {
    throw new Error(
      `query() only runs read-only SQL. Use execute() for: ${nonRead
        .map((s) => s.kind)
        .join(", ")}`,
    );
  }
  const db = openUserDb(args.databasePath, { readonly: true });
  const results = statements.map((s) => runStatement(db, s, { params: args.params, maxRows: args.maxRows }));
  return { results };
}

export function tool_dry_run(args: z.infer<typeof toolInput.dry_run>) {
  const statements = splitStatements(args.sql);
  const report = assessScript(statements);
  return {
    statements: report.perStatement,
    risk: report.risk,
    blocked: report.blocked,
    requiresConfirmation: report.requiresConfirmation,
    destructiveStatements: report.destructiveStatements,
    warnings: report.warnings,
    affectedTables: affectedTables(statements),
  };
}

export function tool_preview(args: z.infer<typeof toolInput.preview>) {
  return runInSandbox(args.databasePath, args.sql, {
    sampleRows: args.sampleRows,
    verifications: args.verifications,
  });
}

export function tool_execute(args: z.infer<typeof toolInput.execute>): ExecutionResult {
  const abs = resolveDbPath(args.databasePath);
  const statements = splitStatements(args.sql);
  const report = assessScript(statements);
  const operationId = args.operationId ?? `op_${nanoid(12)}`;

  if (!report.ok) {
    throw new Error(`Blocked statements are never executed: ${report.blocked.join("; ")}`);
  }
  if (report.requiresConfirmation && !args.confirmDestructive) {
    throw new Error(
      `This operation is ${report.risk} risk and needs confirmDestructive=true. ` +
        `Warnings: ${report.warnings.join(" ")}`,
    );
  }

  const db = openUserDb(args.databasePath, { create: true });
  const before = captureSchema(db);

  let snapshotId: string | null = null;
  let snapshotFilePath: string | null = null;
  const mutates = report.perStatement.some((s) => s.kind !== "read" && s.kind !== "pragma");
  if (args.snapshot && mutates) {
    const snap = createSnapshot(db, {
      databaseId: args.databaseId ?? "adhoc",
      operationId,
      reason: "pre-mutation",
    });
    snapshotId = snap.id;
    snapshotFilePath = snap.filePath;
  }

  const started = performance.now();
  const tx = runInTransaction(db, statements, {});
  const durationMs = Math.round((performance.now() - started) * 100) / 100;

  const after = tx.ok ? captureSchema(db) : before;
  const schemaDiff = diffSchemas(before, after);

  logger.info("execute", { operationId, ok: tx.ok, statements: statements.length, durationMs });

  return {
    operationId,
    ok: tx.ok,
    durationMs,
    statements: tx.results,
    verifications: [],
    schemaDiff,
    snapshotId,
    error: tx.error,
    // @ts-expect-error extra fields carried for the caller
    snapshotFilePath,
    schemaBefore: before,
    schemaAfter: after,
  };
}

export function tool_restore_snapshot(args: z.infer<typeof toolInput.restore_snapshot>) {
  const abs = resolveDbPath(args.databasePath);
  closeUserDb(args.databasePath);
  restoreSnapshot(args.snapshotFilePath, abs);
  const db = openUserDb(args.databasePath, {});
  return { ok: true, schema: captureSchema(db) };
}

export const toolRegistry = {
  list_tables: {
    description: "List all tables and views in the SQLite database.",
    schema: toolInput.list_tables,
    run: tool_list_tables,
  },
  describe_table: {
    description: "Full column/index/foreign-key/row-count detail for one table.",
    schema: toolInput.describe_table,
    run: tool_describe_table,
  },
  schema_snapshot: {
    description: "Capture the complete schema + row counts as a structured snapshot.",
    schema: toolInput.schema_snapshot,
    run: tool_schema_snapshot,
  },
  query: {
    description: "Run read-only SQL (SELECT/EXPLAIN/PRAGMA). Rejects writes.",
    schema: toolInput.query,
    run: tool_query,
  },
  dry_run: {
    description: "Statically analyze SQL: statement kinds, risk level, destructive count, affected tables. Executes nothing.",
    schema: toolInput.dry_run,
    run: tool_dry_run,
  },
  preview: {
    description:
      "Execute SQL against a throwaway in-memory clone and report the real statement results, schema diff, row-level changes and verification outcomes. The real database is never touched.",
    schema: toolInput.preview,
    run: tool_preview,
  },
  execute: {
    description:
      "Execute SQL in a single transaction. Auto-snapshots before mutations. Destructive SQL requires confirmDestructive=true.",
    schema: toolInput.execute,
    run: tool_execute,
  },
  restore_snapshot: {
    description: "Restore a previously captured snapshot file over the database (undo).",
    schema: toolInput.restore_snapshot,
    run: tool_restore_snapshot,
  },
} as const;

export type ToolName = keyof typeof toolRegistry;
