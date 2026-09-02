import { NextRequest, NextResponse } from "next/server";
import { statSync } from "node:fs";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { createBranch, listBranchViews, BranchError } from "@/lib/branching";
import { authGate } from "@/lib/auth";
import { assertQuota, LimitError } from "@/lib/quota";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  if (!repo.getOwnedDatabase(id, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ branches: listBranchViews(id) });
}

const bodySchema = z.object({
  name: z.string().min(1).max(60),
  fromBranchId: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  const database = repo.getOwnedDatabase(id, gate.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = bodySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  try {
    // A branch is a full copy — count it against the disk quota.
    const active = repo.getActiveBranch(id);
    let sourceBytes = active?.sizeBytes || 0;
    try {
      sourceBytes = statSync(active?.filePath ?? database.path).size;
    } catch {
      /* ignore */
    }
    assertQuota(gate.id, { newBytes: sourceBytes });
    const branch = createBranch(id, body.data.name, body.data.fromBranchId);
    return NextResponse.json({ branch, branches: listBranchViews(id) });
  } catch (err) {
    if (err instanceof LimitError) return err.response;
    const status = err instanceof BranchError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
