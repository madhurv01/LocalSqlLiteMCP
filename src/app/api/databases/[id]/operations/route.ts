import { NextResponse } from "next/server";
import { repo } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ops = repo.listOperations(id).map((o) => ({
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
