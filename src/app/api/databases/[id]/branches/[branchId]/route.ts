import { NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { discardBranch, listBranchViews, BranchError } from "@/lib/branching";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  const { id, branchId } = await ctx.params;
  if (!repo.getDatabase(id)) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  try {
    const { switchedTo } = discardBranch(id, branchId);
    return NextResponse.json({ ok: true, switchedTo, branches: listBranchViews(id) });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
