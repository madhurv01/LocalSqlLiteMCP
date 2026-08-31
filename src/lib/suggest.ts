import type { AgentTurn } from "@/lib/turn";
import type { SchemaSnapshot } from "@/lib/types";

/**
 * Context-aware follow-up prompts shown as chips after a completed operation.
 * Pure heuristic — no LLM call.
 */
export function suggestFollowUps(turn: AgentTurn, schema: SchemaSnapshot | null): string[] {
  const out: string[] = [];
  const diff = turn.result?.schemaDiff ?? turn.preview?.schemaDiff;
  const tables = schema?.tables ?? [];

  if (diff?.addedTables?.length) {
    const t = diff.addedTables[0];
    const cols = tables.find((x) => x.name === t)?.columns ?? [];
    const rows = tables.find((x) => x.name === t)?.rowCount ?? 0;
    if (rows === 0) out.push(`Insert 20 sample rows into ${t}`);
    const emailish = cols.find((c) => /email|slug|code|username/i.test(c.name));
    if (emailish) out.push(`Add a unique index on ${t}.${emailish.name}`);
    out.push(`Show all rows in ${t}`);
  }

  for (const c of diff?.changedTables ?? []) {
    if (c.addedColumns.length) {
      out.push(`Backfill ${c.name}.${c.addedColumns[0]} for existing rows`);
    }
    if (c.rowCountAfter > c.rowCountBefore) {
      out.push(`Show the newest rows in ${c.name}`);
    }
  }

  if (!out.length && tables.length) {
    const biggest = [...tables].sort((a, b) => b.rowCount - a.rowCount)[0];
    if (biggest) {
      out.push(`How many rows are in ${biggest.name}?`);
      const fk = tables.find((t) => t.foreignKeys.length === 0 && t.name !== biggest.name);
      if (fk) out.push(`Create a table related to ${biggest.name}`);
    }
  }

  return [...new Set(out)].slice(0, 3);
}
