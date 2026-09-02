import { NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { activateBranch, listBranchViews, BranchError } from "@/lib/branching";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  const { id, branchId } = await ctx.params;
  if (!repo.getDatabase(id)) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  try {
    const branch = activateBranch(id, branchId);
    return NextResponse.json({
      branch: { id: branch.id, name: branch.name, isMain: branch.isMain },
      branches: listBranchViews(id),
    });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
