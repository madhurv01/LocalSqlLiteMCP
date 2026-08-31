import { isAbsolute, resolve, relative, extname, sep } from "node:path";
import { config } from "@/lib/config";

const ALLOWED_EXT = new Set([".db", ".sqlite", ".sqlite3"]);

export class PathSafetyError extends Error {}

/**
 * Resolve a user-supplied database path against LOCALDB_DB_ROOT and reject
 * anything that escapes the root, uses a disallowed extension, or is a URI.
 */
export function resolveDbPath(input: string): string {
  const raw = input.trim();
  if (!raw) throw new PathSafetyError("Empty database path.");
  if (/^[a-z]+:\/\//i.test(raw)) {
    throw new PathSafetyError("Remote URIs are not allowed. Use a local file path.");
  }
  if (raw.includes("\0")) throw new PathSafetyError("Invalid path.");

  const abs = isAbsolute(raw) ? resolve(raw) : resolve(config.dbRoot, raw);
  const rel = relative(config.dbRoot, abs);

  if (rel === "" || rel.startsWith("..") || (isAbsolute(rel))) {
    throw new PathSafetyError(
      `Path escapes the database root (${config.dbRoot}). Place the file inside it.`,
    );
  }
  if (rel.split(sep).some((seg) => seg === "..")) {
    throw new PathSafetyError("Path traversal detected.");
  }

  const ext = extname(abs).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new PathSafetyError(
      `Only ${[...ALLOWED_EXT].join(", ")} files are allowed (got "${ext || "none"}").`,
    );
  }
  return abs;
}

export function isInsideDbRoot(abs: string): boolean {
  const rel = relative(config.dbRoot, resolve(abs));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
