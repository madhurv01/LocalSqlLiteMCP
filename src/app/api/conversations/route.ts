import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const databaseId = req.nextUrl.searchParams.get("databaseId");
  if (!databaseId) return NextResponse.json({ error: "databaseId required" }, { status: 400 });
  return NextResponse.json({ conversations: repo.listConversations(databaseId) });
}

const bodySchema = z.object({ databaseId: z.string().min(1), title: z.string().optional() });

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!repo.getDatabase(body.data.databaseId)) {
    return NextResponse.json({ error: "Unknown database" }, { status: 404 });
  }
  const conv = repo.createConversation(body.data.databaseId, body.data.title);
  return NextResponse.json({ conversation: conv });
}
