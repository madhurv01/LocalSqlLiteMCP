import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDbPath } from "./path-safety";
import { logger } from "@/lib/logger";

/**
 * One cached connection per absolute file path. User databases are isolated
 * from the app metadata database and from each other.
 */
const pool = new Map<string, Database.Database>();

export interface OpenOptions {
  create?: boolean;
  readonly?: boolean;
}

export function openUserDb(userPath: string, opts: OpenOptions = {}): Database.Database {
  const abs = resolveDbPath(userPath);

  if (!opts.create && !existsSync(abs)) {
    throw new Error(`Database file not found: ${abs}`);
  }

  const key = `${abs}::${opts.readonly ? "ro" : "rw"}`;
  const cached = pool.get(key);
  if (cached && cached.open) return cached;

  if (opts.create && !existsSync(abs)) {
    mkdirSync(dirname(abs), { recursive: true });
  }

  const db = new Database(abs, {
    readonly: opts.readonly ?? false,
    fileMustExist: !opts.create,
  });
  if (!opts.readonly) {
    // journal_mode is a write; only safe on a writable connection.
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 4000");
  pool.set(key, db);
  logger.debug("opened user db", { abs, readonly: !!opts.readonly });
  return db;
}

export function closeUserDb(userPath: string) {
  const abs = resolveDbPath(userPath);
  for (const key of [...pool.keys()]) {
    if (key.startsWith(`${abs}::`)) {
      pool.get(key)?.close();
      pool.delete(key);
    }
  }
}

export function closeAll() {
  for (const db of pool.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  pool.clear();
}
