import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repo } from "@/lib/repo";
import { userRoot } from "@/lib/config";
import { resolveUserDbPath, PathSafetyError } from "@/lib/sqlite/path-safety";
import { openUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";
import { authGate } from "@/lib/auth";
import { assertQuota, LimitError } from "@/lib/quota";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// "SQLite format 3\0"
const SQLITE_MAGIC = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);

function safeName(raw: string): string {
  const base = raw.replace(/\.(db|sqlite|sqlite3)$/i, "");
  const clean = base.replace(/[^a-zA-Z0-9 _-]+/g, "_").replace(/\s+/g, "_").toLowerCase().slice(0, 60);
  return `${clean || "upload"}.db`;
}

export async function POST(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const user = gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file'." }, { status: 400 });
  }
  if (!/\.(db|sqlite|sqlite3)$/i.test(file.name)) {
    return NextResponse.json({ error: "File must be .db, .sqlite or .sqlite3." }, { status: 400 });
  }

  try {
    assertQuota(user.id, { newDb: true, newBytes: file.size });

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 100 || !bytes.subarray(0, 16).equals(SQLITE_MAGIC)) {
      return NextResponse.json({ error: "That is not a valid SQLite database file." }, { status: 400 });
    }

    let abs = resolveUserDbPath(user.id, join(userRoot(user.id), safeName(file.name)));
    if (existsSync(abs)) {
      abs = resolveUserDbPath(
        user.id,
        join(userRoot(user.id), safeName(`${file.name}-${Date.now().toString(36)}`)),
      );
    }
    writeFileSync(abs, bytes);

    // Validate it actually opens.
    const db = openUserDb(abs, { readonly: true });
    const schema = captureSchema(db);

    const record = repo.registerDatabase(user.id, abs, file.name.replace(/\.(db|sqlite|sqlite3)$/i, ""));
    repo.ensureMainBranch(record.id);
    logger.info("database uploaded", { user: user.id, bytes: bytes.length, id: record.id });
    return NextResponse.json({ database: record, schema });
  } catch (err) {
    if (err instanceof LimitError) return err.response;
    const status = err instanceof PathSafetyError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

export const maxDuration = 60;
