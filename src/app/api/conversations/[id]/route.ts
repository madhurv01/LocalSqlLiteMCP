import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

async function ownedConv(req: NextRequest, id: string) {
  const gate = await authGate(req);
  if (gate instanceof Response) return { error: gate };
  const conv = repo.getOwnedConversation(id, gate.id);
  if (!conv) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { conv };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await ownedConv(req, id);
  if (r.error) return r.error;
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
  const r = await ownedConv(req, id);
  if (r.error) return r.error;
  const body = z.object({ title: z.string().min(1).max(120) }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  repo.renameConversation(id, body.data.title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await ownedConv(req, id);
  if (r.error) return r.error;
  repo.deleteConversation(id);
  return NextResponse.json({ ok: true });
}
