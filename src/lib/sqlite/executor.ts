import type Database from "better-sqlite3";
import type { StatementResult, StatementKind } from "@/lib/types";
import { classifyStatement, extractTables } from "./safety";
import { config } from "@/lib/config";

const READ_KINDS: StatementKind[] = ["read", "pragma"];

export interface RunOptions {
  /** Cap rows captured for read statements. */
  maxRows?: number;
  params?: unknown[];
}

export function runStatement(
  db: Database.Database,
  sql: string,
  opts: RunOptions = {},
): StatementResult {
  const kind = classifyStatement(sql);
  const started = performance.now();
  const maxRows = opts.maxRows ?? config.maxPreviewRows;

  try {
    const stmt = db.prepare(sql);
    if (READ_KINDS.includes(kind) && stmt.reader) {
      const all = opts.params ? stmt.all(...(opts.params as [])) : stmt.all();
      const rows = (all as Record<string, unknown>[]).slice(0, maxRows);
      const columns = rows.length
        ? Object.keys(rows[0])
        : (stmt.columns?.() ?? []).map((c) => c.name);
      return {
        sql,
        kind,
        rowsAffected: 0,
        rows,
        columns,
        durationMs: round(performance.now() - started),
      };
    }
    const info = opts.params ? stmt.run(...(opts.params as [])) : stmt.run();
    return {
      sql,
      kind,
      rowsAffected: info.changes ?? 0,
      durationMs: round(performance.now() - started),
    };
  } catch (err) {
    return {
      sql,
      kind,
      rowsAffected: 0,
      durationMs: round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Execute a list of statements inside a single transaction.
 * Any error rolls the whole batch back.
 */
export function runInTransaction(
  db: Database.Database,
  statements: string[],
  opts: RunOptions = {},
): { ok: boolean; results: StatementResult[]; error?: string } {
  const results: StatementResult[] = [];
  const exec = db.transaction(() => {
    for (const sql of statements) {
      const r = runStatement(db, sql, opts);
      results.push(r);
      if (r.error) {
        throw new Error(`Statement failed: ${r.error}`);
      }
    }
  });

  try {
    exec();
    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      results,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function affectedTables(statements: string[]): string[] {
  const set = new Set<string>();
  for (const s of statements) extractTables(s).forEach((t) => set.add(t));
  return [...set];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
