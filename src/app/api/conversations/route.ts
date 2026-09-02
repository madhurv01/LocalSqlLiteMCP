import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const databaseId = req.nextUrl.searchParams.get("databaseId");
  if (!databaseId) return NextResponse.json({ error: "databaseId required" }, { status: 400 });
  if (!repo.getOwnedDatabase(databaseId, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ conversations: repo.listConversations(databaseId) });
}

const bodySchema = z.object({ databaseId: z.string().min(1), title: z.string().optional() });

export async function POST(req: NextRequest) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const body = bodySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!repo.getOwnedDatabase(body.data.databaseId, gate.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const conv = repo.createConversation(body.data.databaseId, body.data.title);
  return NextResponse.json({ conversation: conv });
}
