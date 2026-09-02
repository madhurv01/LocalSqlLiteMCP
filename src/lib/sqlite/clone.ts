import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

function esc(p: string): string {
  return p.replace(/'/g, "''");
}

/**
 * Write a complete, consistent copy of a SQLite database to `destAbs`.
 * `VACUUM INTO` produces a fully-checkpointed single-file copy. The source is
 * opened read-only and never modified.
 */
export function cloneDatabaseToFile(srcAbs: string, destAbs: string): void {
  mkdirSync(dirname(destAbs), { recursive: true });
  if (existsSync(destAbs)) rmSync(destAbs);
  if (!existsSync(srcAbs)) {
    const empty = new Database(destAbs);
    empty.close();
    return;
  }
  const src = new Database(srcAbs, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${esc(destAbs)}'`);
  } finally {
    src.close();
  }
  // Match the rest of the app's journal mode.
  const dest = new Database(destAbs);
  try {
    dest.pragma("journal_mode = WAL");
  } finally {
    dest.close();
  }
}

/**
 * Load a private, in-memory copy of a database. Nothing on disk is touched
 * beyond a briefly-created, immediately-deleted scratch file.
 */
export function loadInMemoryCopy(srcAbs: string, scratchAbs: string): Database.Database {
  if (!existsSync(srcAbs)) return new Database(":memory:");
  const src = new Database(srcAbs, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${esc(scratchAbs)}'`);
  } finally {
    src.close();
  }
  try {
    const bytes = readFileSync(scratchAbs);
    return bytes.length >= 512 ? new Database(bytes) : new Database(":memory:");
  } finally {
    try {
      if (existsSync(scratchAbs)) rmSync(scratchAbs);
    } catch {
      /* ignore */
    }
  }
}
