import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { chatRequestSchema } from "@/lib/validation";
import { repo } from "@/lib/repo";
import { runPipeline } from "@/lib/agent/orchestrator";
import { sseResponse } from "@/lib/sse";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const parsed = chatRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { databaseId, message } = parsed.data;

  const database = repo.getDatabase(databaseId);
  if (!database) return Response.json({ error: "Unknown database" }, { status: 404 });
  if (!existsSync(database.path)) {
    return Response.json({ error: "Database file is missing on disk" }, { status: 410 });
  }

  let conversationId = parsed.data.conversationId;
  if (!conversationId || !repo.listConversations(databaseId).some((c) => c.id === conversationId)) {
    conversationId = repo.createConversation(databaseId, message.slice(0, 60)).id;
  }

  repo.addMessage(conversationId, "user", message);
  repo.touchDatabase(databaseId);

  const history = repo
    .listMessages(conversationId)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const persisting = teeAndPersist(
    runPipeline({
      databaseId,
      databasePath: database.path,
      conversationId,
      message,
      history,
    }),
    conversationId!,
  );

  return sseResponse(persisting);
}

/** Pass events through while building + saving the assistant transcript. */
async function* teeAndPersist(
  gen: AsyncGenerator<AgentEvent>,
  conversationId: string,
): AsyncGenerator<AgentEvent> {
  let reasoning = "";
  const stages: AgentEvent[] = [];
  let finalDone: Extract<AgentEvent, { type: "done" }> | null = null;

  for await (const evt of gen) {
    if (evt.type === "token") reasoning += evt.text;
    if (evt.type === "stage") stages.push(evt);
    if (evt.type === "done") finalDone = evt;
    yield evt;
  }

  const summary =
    finalDone?.plan?.summary ??
    (reasoning.trim() || "No plan produced.");
  repo.addMessage(conversationId, "assistant", summary, {
    reasoning,
    stages,
    plan: finalDone?.plan ?? null,
    preview: finalDone?.preview ?? null,
    operationId: finalDone?.operationId ?? null,
    awaitingConfirmation: finalDone?.awaitingConfirmation ?? false,
    result: finalDone?.result ?? null,
  });
}
