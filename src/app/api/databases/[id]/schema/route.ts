import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { repo } from "@/lib/repo";
import { openUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;

  const db = repo.getOwnedDatabase(id, gate.id);
  if (!db) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const branch = repo.getActiveBranch(id);
  const path = branch?.filePath ?? db.path;
  if (!existsSync(path)) return NextResponse.json({ error: "File missing on disk" }, { status: 410 });
  const conn = openUserDb(path, { readonly: true });
  return NextResponse.json({
    schema: captureSchema(conn),
    branch: branch ? { id: branch.id, name: branch.name, isMain: branch.isMain } : null,
  });
}
