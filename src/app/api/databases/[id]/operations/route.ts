import { NextRequest, NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  if (!repo.getOwnedDatabase(id, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const active = repo.getActiveBranch(id);
  const rows = active
    ? repo.listBranchOperations(id, active.id, active.isMain).slice().reverse()
    : repo.listOperations(id);
  const ops = rows.map((o) => ({
    id: o.id,
    status: o.status,
    intent: o.intent,
    risk: o.risk,
    durationMs: o.durationMs,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
    plan: safeParse(o.plan),
    result: safeParse(o.result),
    preview: safeParse(o.previewResult),
    schemaBefore: safeParse(o.schemaBefore),
    schemaAfter: safeParse(o.schemaAfter),
    snapshotId: o.snapshotId,
  }));
  return NextResponse.json({ operations: ops });
}

function safeParse(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
