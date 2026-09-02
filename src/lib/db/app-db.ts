import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "@/lib/config";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

/**
 * The app metadata schema. Created on first launch and kept in sync by the
 * additive migrations in `runInlineMigrations`. Mirrors `schema.ts`, which is
 * the Drizzle query-builder view of these same tables.
 */
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'local',
  label TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  active_branch_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_branch_id TEXT,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  is_main INTEGER NOT NULL DEFAULT 0,
  base_schema TEXT,
  forked_from_operation_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into_branch_id TEXT,
  merged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  intent TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'safe',
  plan TEXT NOT NULL,
  result TEXT,
  preview_result TEXT,
  schema_before TEXT,
  schema_after TEXT,
  snapshot_id TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  operation_id TEXT,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'pre-mutation',
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export function getAppDb() {
  if (_db) return _db;
  if (!existsSync(dirname(config.appDbPath))) {
    mkdirSync(dirname(config.appDbPath), { recursive: true });
  }
  _sqlite = new Database(config.appDbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.exec(BOOTSTRAP_SQL);
  runInlineMigrations(_sqlite);
  _db = drizzle(_sqlite, { schema });
  return _db;
}

/**
 * Idempotent additive column migrations for databases created by an older
 * bootstrap. `CREATE TABLE IF NOT EXISTS` never alters an existing table.
 */
function runInlineMigrations(db: Database.Database) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  try {
    addColumn("operations", "preview_result", "preview_result TEXT");
    addColumn("operations", "branch_id", "branch_id TEXT");
    addColumn("databases", "active_branch_id", "active_branch_id TEXT");
    addColumn("databases", "owner_id", "owner_id TEXT NOT NULL DEFAULT 'local'");
    addColumn("branches", "size_bytes", "size_bytes INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* fresh db — columns already present via bootstrap */
  }
}

export { schema };
