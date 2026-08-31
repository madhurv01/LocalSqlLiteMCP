import { NextRequest, NextResponse } from "next/server";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { config } from "@/lib/config";
import { resolveDbPath, PathSafetyError } from "@/lib/sqlite/path-safety";
import { openUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("open"), path: z.string().min(1), label: z.string().optional() }),
  z.object({
    mode: z.literal("create"),
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9 _-]+$/),
  }),
]);

export async function GET() {
  const dbs = repo.listDatabases().map((d) => ({ ...d, exists: existsSync(d.path) }));
  return NextResponse.json({ databases: dbs, dbRoot: config.dbRoot });
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request", detail: String(err) }, { status: 400 });
  }

  try {
    let abs: string;
    let label: string;
    if (body.mode === "create") {
      const fileName = `${body.name.replace(/\s+/g, "_").toLowerCase()}.db`;
      abs = resolveDbPath(join(config.dbRoot, fileName));
      if (existsSync(abs)) {
        return NextResponse.json({ error: "A database with that name already exists." }, { status: 409 });
      }
      openUserDb(abs, { create: true });
      label = body.name;
    } else {
      abs = resolveDbPath(body.path);
      if (!existsSync(abs)) {
        return NextResponse.json({ error: `File not found inside db root: ${abs}` }, { status: 404 });
      }
      openUserDb(abs, { readonly: true });
      label = body.label || basename(abs);
    }

    const record = repo.registerDatabase(abs, label);
    const db = openUserDb(abs, { readonly: true });
    return NextResponse.json({ database: record, schema: captureSchema(db) });
  } catch (err) {
    const status = err instanceof PathSafetyError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
