import { NextRequest, NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { compareBranch, BranchError } from "@/lib/branching";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id, branchId } = await ctx.params;
  if (!repo.getOwnedDatabase(id, gate.id) || !repo.getOwnedBranch(branchId, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ comparison: compareBranch(id, branchId) });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
