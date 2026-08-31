import { NextResponse } from "next/server";
import { repo } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ snapshots: repo.listSnapshots(id) });
}
