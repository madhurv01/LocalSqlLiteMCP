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
  return NextResponse.json({ snapshots: repo.listSnapshots(id) });
}
