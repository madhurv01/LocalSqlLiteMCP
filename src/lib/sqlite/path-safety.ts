import { isAbsolute, resolve, relative, extname, sep } from "node:path";
import { config } from "@/lib/config";

const ALLOWED_EXT = new Set([".db", ".sqlite", ".sqlite3"]);

export class PathSafetyError extends Error {}

/** Roots a database file is allowed to live under. */
function allowedRoots(): string[] {
  return [config.dbRoot, config.branchDir, config.snapshotDir];
}

function underRoot(abs: string, root: string): boolean {
  const rel = relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
}

/**
 * Resolve a user-supplied database path. A bare/relative path resolves against
 * LOCALDB_DB_ROOT. Absolute paths are accepted only if they sit inside one of
 * the allowed roots (the DB root, or the app's branch/snapshot dirs). URIs,
 * traversal and non-sqlite extensions are rejected.
 */
export function resolveDbPath(input: string): string {
  const raw = input.trim();
  if (!raw) throw new PathSafetyError("Empty database path.");
  if (/^[a-z]+:\/\//i.test(raw)) {
    throw new PathSafetyError("Remote URIs are not allowed. Use a local file path.");
  }
  if (raw.includes("\0")) throw new PathSafetyError("Invalid path.");

  const abs = isAbsolute(raw) ? resolve(raw) : resolve(config.dbRoot, raw);

  if (!allowedRoots().some((root) => underRoot(abs, root))) {
    throw new PathSafetyError(
      `Path is outside the allowed roots (${config.dbRoot}). Place the file inside it.`,
    );
  }

  const ext = extname(abs).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new PathSafetyError(
      `Only ${[...ALLOWED_EXT].join(", ")} files are allowed (got "${ext || "none"}").`,
    );
  }
  return abs;
}
