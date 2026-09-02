import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { mergeBranch, listBranchViews, BranchError } from "@/lib/branching";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ confirm: z.boolean().default(false) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; branchId: string }> },
) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id, branchId } = await ctx.params;
  if (!repo.getOwnedDatabase(id, gate.id) || !repo.getOwnedBranch(branchId, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
