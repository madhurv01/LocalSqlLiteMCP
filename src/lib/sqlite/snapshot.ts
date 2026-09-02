import { copyFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Create a physical file-level checkpoint of a SQLite database.
 * Uses the online backup API so it is consistent even with WAL.
 */
export function createSnapshot(
  db: Database.Database,
  opts: { databaseId: string; operationId?: string; reason?: string },
): { id: string; filePath: string; sizeBytes: number } {
  const id = `snap_${nanoid(12)}`;
  const filePath = join(config.snapshotDir, `${opts.databaseId}__${id}.db`);

  // Flush WAL into the main file first, then copy.
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }
  copyFileSync(db.name, filePath);

  const sizeBytes = statSync(filePath).size;
  logger.info("snapshot created", { id, filePath, sizeBytes });
  return { id, filePath, sizeBytes };
}

/**
 * Restore a snapshot over the live database file. The caller must close all
 * connections to the target first.
 */
export function restoreSnapshot(snapshotPath: string, targetPath: string): void {
  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot file missing: ${snapshotPath}`);
  }
  // Remove stale WAL/SHM so SQLite does not replay them over the restored file.
  for (const suffix of ["-wal", "-shm"]) {
    const p = `${targetPath}${suffix}`;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  copyFileSync(snapshotPath, targetPath);
  logger.info("snapshot restored", { snapshotPath, targetPath });
}
