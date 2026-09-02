import { NextRequest, NextResponse } from "next/server";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { userRoot } from "@/lib/config";
import { resolveUserDbPath, PathSafetyError } from "@/lib/sqlite/path-safety";
import { openUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";
import { authGate } from "@/lib/auth";
import { assertQuota, LimitError } from "@/lib/quota";

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

export async function GET(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;

  const dbs = repo.listDatabases(gate.id).map((d) => ({ ...d, exists: existsSync(d.path) }));
  return NextResponse.json({ databases: dbs, dbRoot: userRoot(gate.id) });
}

export async function POST(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const user = gate;

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
      assertQuota(user.id, { newDb: true });
      const fileName = `${body.name.replace(/\s+/g, "_").toLowerCase()}.db`;
      abs = resolveUserDbPath(user.id, join(userRoot(user.id), fileName));
      if (existsSync(abs)) {
        return NextResponse.json({ error: "A database with that name already exists." }, { status: 409 });
      }
      openUserDb(abs, { create: true });
      label = body.name;
    } else {
      abs = resolveUserDbPath(user.id, body.path);
      if (!existsSync(abs)) {
        return NextResponse.json({ error: "File not found in your workspace." }, { status: 404 });
      }
      openUserDb(abs, { readonly: true });
      label = body.label || basename(abs);
    }

    const record = repo.registerDatabase(user.id, abs, label);
    repo.ensureMainBranch(record.id);
    const db = openUserDb(abs, { readonly: true });
    return NextResponse.json({ database: record, schema: captureSchema(db) });
  } catch (err) {
    if (err instanceof LimitError) return err.response;
    const status = err instanceof PathSafetyError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
