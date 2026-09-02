import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { createBranch, listBranchViews, BranchError } from "@/lib/branching";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!repo.getDatabase(id)) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  return NextResponse.json({ branches: listBranchViews(id) });
}

const bodySchema = z.object({
  name: z.string().min(1).max(60),
  fromBranchId: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!repo.getDatabase(id)) return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  const body = bodySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  try {
    const branch = createBranch(id, body.data.name, body.data.fromBranchId);
    return NextResponse.json({ branch, branches: listBranchViews(id) });
  } catch (err) {
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
