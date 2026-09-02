import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { userRoot } from "@/lib/config";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

const EXT = /\.(db|sqlite|sqlite3)$/i;

/** List candidate SQLite files inside the caller's private workspace. */
export async function GET(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;

  const root = userRoot(gate.id);
  const found: { name: string; relativePath: string; sizeBytes: number; modifiedAt: string }[] = [];

  const walk = (dir: string, prefix: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory() && depth < 2 && !entry.startsWith(".") && entry !== "u") {
        walk(full, `${prefix}${entry}/`, depth + 1);
      } else if (st.isFile() && EXT.test(entry)) {
        found.push({
          name: entry,
          relativePath: `${prefix}${entry}`,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
        });
      }
    }
  };
  walk(root, "", 0);
  found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return NextResponse.json({ root, files: found });
}
