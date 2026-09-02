import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { mergeBranch, listBranchViews, BranchError } from "@/lib/branching";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ confirm: z.boolean().default(false) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  const { id, branchId } = await ctx.params;
  if (!repo.getDatabase(id)) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  const confirm = body.success ? body.data.confirm : false;

  try {
    const result = mergeBranch(id, branchId, confirm);
    return NextResponse.json({ ...result, branches: listBranchViews(id) });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
