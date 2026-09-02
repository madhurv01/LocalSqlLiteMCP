import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { loadInMemoryCopy } from "./clone";
import type {
  PreviewResult,
  RowDelta,
  SampleChange,
  StatementResult,
  VerificationResult,
} from "@/lib/types";
import { captureSchema } from "./introspect";
import { diffSchemas } from "./diff";
import { runStatement } from "./executor";
import { assessScript, extractTables, splitStatements } from "./safety";
import { resolveDbPath } from "./path-safety";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

const NON_DETERMINISTIC =
  /\b(random\s*\(\s*\)|randomblob\s*\(|current_time|current_date|current_timestamp)\b|['"(]\s*now\s*['")]/i;

const ROW_DIFF_LIMIT = 50_000;

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface SandboxOptions {
  sampleRows?: number;
  verifications?: { description: string; sql: string }[];
}

/**
 * Execute `sql` against an in-memory clone of the database and report what
 * actually happened — real statement results, real schema + row diff, real
 * verification outcomes — then discard the clone. Nothing touches disk.
 */
export function runInSandbox(
  databasePath: string,
  sql: string,
  opts: SandboxOptions = {},
): PreviewResult {
  const abs = resolveDbPath(databasePath);
  const statements = splitStatements(sql);
  const report = assessScript(statements);
  const affectedTables = [...new Set(statements.flatMap((s) => extractTables(s)))];
  const nonDeterministic = statements.some((s) => NON_DETERMINISTIC.test(s));
  const sampleRows = opts.sampleRows ?? config.sandboxSampleRows;

  const emptyDiff = { addedTables: [], removedTables: [], changedTables: [] };
  const base: PreviewResult = {
    mode: "static",
    ok: report.ok,
    durationMs: 0,
    cloneBytes: 0,
    statements: [],
    schemaDiff: emptyDiff,
    verifications: [],
    rowDeltas: [],
    sampleChanges: [],
    nonDeterministic,
    affectedTables,
  };

  if (!report.ok) {
    return { ...base, ok: false, error: `Blocked statements: ${report.blocked.join("; ")}` };
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(abs).size;
  } catch {
    /* new/empty database */
  }
  if (sizeBytes > config.sandboxMaxMb * 1024 * 1024) {
    return {
      ...base,
      skippedReason: `Database is ${(sizeBytes / 1024 / 1024).toFixed(0)} MB (> LOCALDB_SANDBOX_MAX_MB=${config.sandboxMaxMb}). Showing static analysis only.`,
    };
  }

  // --- clone -----------------------------------------------------------
  // A private, in-memory copy — the sandbox leaves nothing on disk and never
  // touches the real database.
  let clone: Database.Database;
  try {
    clone = loadInMemoryCopy(abs, join(config.sandboxDir, `preview_${nanoid(10)}.db`));
  } catch (err) {
    logger.warn("sandbox clone failed, static preview", { err: String(err) });
    return { ...base, skippedReason: `Could not clone database: ${(err as Error).message}` };
  }
  clone.pragma("foreign_keys = ON");

  const started = performance.now();
  const schemaBefore = captureSchema(clone);

  // Snapshot rows of affected tables BEFORE mutating, for a real row-level diff.
  const beforeRows = new Map<string, Map<string, Record<string, unknown>>>();
  for (const t of affectedTables) {
    const known = schemaBefore.tables.find((x) => x.name === t);
    if (!known || known.type !== "table" || known.rowCount > ROW_DIFF_LIMIT) continue;
    beforeRows.set(t, loadRows(clone, t));
  }

  // --- run the batch in a transaction ------------------------------
  const results: StatementResult[] = [];
  let ok = true;
  let error: string | undefined;
  const tx = clone.transaction(() => {
    for (const s of statements) {
      const r = runStatement(clone, s, {});
      results.push(r);
      if (r.error) throw new Error(r.error);
    }
  });
  try {
    tx();
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  const schemaAfter = ok ? captureSchema(clone) : schemaBefore;
  const schemaDiff = diffSchemas(schemaBefore, schemaAfter);

  // --- row-level diff + samples ----------------------------------
  const sampleChanges: SampleChange[] = [];
  if (ok) {
    for (const [t, before] of beforeRows) {
      let after: Map<string, Record<string, unknown>>;
      try {
        after = loadRows(clone, t);
      } catch {
        continue; // table dropped/renamed
      }
      collectChanges(t, before, after, sampleChanges, sampleRows);
    }
    // brand-new tables: everything is an insert
    for (const t of schemaDiff.addedTables) {
      if (sampleChanges.length >= sampleRows) break;
      try {
        const rows = loadRows(clone, t);
        for (const [, row] of rows) {
          if (sampleChanges.length >= sampleRows) break;
          sampleChanges.push({ table: t, op: "insert", after: strip(row) });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const rowDeltas: RowDelta[] = [];
  const afterByName = new Map(schemaAfter.tables.map((x) => [x.name, x]));
  for (const b of schemaBefore.tables) {
    const a = afterByName.get(b.name);
    if (a && a.rowCount !== b.rowCount) {
      rowDeltas.push({ table: b.name, before: b.rowCount, after: a.rowCount });
    } else if (!a) {
      rowDeltas.push({ table: b.name, before: b.rowCount, after: 0 });
    }
  }
  for (const a of schemaAfter.tables) {
    if (!schemaBefore.tables.some((b) => b.name === a.name)) {
      rowDeltas.push({ table: a.name, before: 0, after: a.rowCount });
    }
  }

  // --- verifications on the mutated clone -----------------------
  const verifications: VerificationResult[] = [];
  if (ok) {
    for (const v of opts.verifications ?? []) {
      try {
        const rows = clone.prepare(v.sql).all() as Record<string, unknown>[];
        verifications.push({
          description: v.description,
          sql: v.sql,
          passed: rows.length > 0,
          rows: rows.slice(0, 20),
        });
      } catch (err) {
        verifications.push({
          description: v.description,
          sql: v.sql,
          passed: false,
          rows: [{ error: err instanceof Error ? err.message : String(err) }],
        });
      }
    }
  }

  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  clone.close();

  return {
    mode: "sandbox",
    ok,
    durationMs,
    cloneBytes: sizeBytes,
    statements: results,
    schemaDiff,
    verifications,
    rowDeltas,
    sampleChanges,
    nonDeterministic,
    affectedTables,
    error,
  };
}

// --------------------------------------------------------------------------

function loadRows(
  db: Database.Database,
  table: string,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare(`SELECT rowid AS __rid, * FROM ${quoteId(table)}`).all() as Record<
      string,
      unknown
    >[];
    for (const r of rows) map.set(String(r.__rid), r);
    return map;
  } catch {
    // WITHOUT ROWID table — key on full row
    rows = db.prepare(`SELECT * FROM ${quoteId(table)}`).all() as Record<string, unknown>[];
    for (const r of rows) map.set(JSON.stringify(r), r);
    return map;
  }
}

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const { __rid, ...rest } = row;
  void __rid;
  return rest;
}

function collectChanges(
  table: string,
  before: Map<string, Record<string, unknown>>,
  after: Map<string, Record<string, unknown>>,
  out: SampleChange[],
  limit: number,
) {
  for (const [key, row] of after) {
    if (out.length >= limit) return;
    if (!before.has(key)) out.push({ table, op: "insert", after: strip(row) });
  }
  for (const [key, row] of before) {
    if (out.length >= limit) return;
    if (!after.has(key)) out.push({ table, op: "delete", before: strip(row) });
  }
  for (const [key, bRow] of before) {
    if (out.length >= limit) return;
    const aRow = after.get(key);
    if (aRow && JSON.stringify(bRow) !== JSON.stringify(aRow)) {
      out.push({ table, op: "update", before: strip(bRow), after: strip(aRow) });
    }
  }
}
