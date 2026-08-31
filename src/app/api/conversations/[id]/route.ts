import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const messages = repo.listMessages(id).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    meta: m.meta ? JSON.parse(m.meta) : null,
    createdAt: m.createdAt,
  }));
  return NextResponse.json({ messages });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = z.object({ title: z.string().min(1).max(120) }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  repo.renameConversation(id, body.data.title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  repo.deleteConversation(id);
  return NextResponse.json({ ok: true });
}
