import type Database from "better-sqlite3";
import type { SchemaSnapshot, TableInfo, ColumnInfo } from "@/lib/types";

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function listTables(db: Database.Database): { name: string; type: "table" | "view" }[] {
  const rows = db
    .prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as { name: string; type: "table" | "view" }[];
  return rows;
}

export function countRows(db: Database.Database, table: string): number {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteId(table)}`).get() as { c: number };
    return r?.c ?? 0;
  } catch {
    return 0;
  }
}

export function describeTable(db: Database.Database, name: string, type: "table" | "view"): TableInfo {
  const cols = db.prepare(`PRAGMA table_info(${quoteId(name)})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: string | null;
  }>;

  const columns: ColumnInfo[] = cols.map((c) => ({
    name: c.name,
    type: c.type || "",
    notNull: !!c.notnull,
    primaryKey: !!c.pk,
    defaultValue: c.dflt_value,
  }));

  const idxList = db.prepare(`PRAGMA index_list(${quoteId(name)})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const indexes = idxList.map((idx) => {
    const info = db.prepare(`PRAGMA index_info(${quoteId(idx.name)})`).all() as Array<{ name: string }>;
    return { name: idx.name, unique: !!idx.unique, columns: info.map((i) => i.name) };
  });

  const fkList = db.prepare(`PRAGMA foreign_key_list(${quoteId(name)})`).all() as Array<{
    table: string;
    from: string;
    to: string;
  }>;
  const foreignKeys = fkList.map((fk) => ({ column: fk.from, refTable: fk.table, refColumn: fk.to }));

  const createRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
    .get(name) as { sql: string } | undefined;

  return {
    name,
    type,
    columns,
    rowCount: type === "table" ? countRows(db, name) : 0,
    indexes,
    foreignKeys,
    createSql: createRow?.sql ?? "",
  };
}

export function captureSchema(db: Database.Database): SchemaSnapshot {
  const tables = listTables(db).map((t) => describeTable(db, t.name, t.type));
  return { capturedAt: new Date().toISOString(), tables };
}
