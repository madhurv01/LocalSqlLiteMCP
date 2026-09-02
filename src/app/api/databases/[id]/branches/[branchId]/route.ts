import { NextRequest, NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { discardBranch, listBranchViews, BranchError } from "@/lib/branching";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(
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
    const { switchedTo } = discardBranch(id, branchId);
    return NextResponse.json({ ok: true, switchedTo, branches: listBranchViews(id) });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
