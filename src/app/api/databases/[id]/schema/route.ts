import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { repo } from "@/lib/repo";
import { openUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = repo.getDatabase(id);
  if (!db) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  if (!existsSync(db.path)) return NextResponse.json({ error: "File missing on disk" }, { status: 410 });
  const conn = openUserDb(db.path, { readonly: true });
  return NextResponse.json({ schema: captureSchema(conn) });
}
