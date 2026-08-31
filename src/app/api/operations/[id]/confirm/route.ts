import { NextRequest } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/repo";
import { executeOperation } from "@/lib/agent/orchestrator";
import { sseResponse } from "@/lib/sse";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({ approve: z.boolean() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  const op = repo.getOperation(id);
  if (!op) return Response.json({ error: "Operation not found" }, { status: 404 });
  if (op.status !== "awaiting_confirmation") {
    return Response.json({ error: `Operation is "${op.status}", not awaiting confirmation` }, { status: 409 });
  }

  if (!body.data.approve) {
    repo.setOperationStatus(id, "cancelled");
    if (op.conversationId) {
      repo.addMessage(op.conversationId, "assistant", "Operation cancelled by user. Nothing was executed.", {
        operationId: id,
        cancelled: true,
      });
    }
    return Response.json({ ok: true, status: "cancelled" });
  }

  async function* run(): AsyncGenerator<AgentEvent> {
    for await (const evt of executeOperation(id)) {
      if (evt.type === "done" && op!.conversationId) {
        repo.addMessage(
          op!.conversationId,
          "assistant",
          evt.result?.ok ? "Confirmed operation executed and verified." : "Confirmed operation failed.",
          { operationId: id, result: evt.result ?? null, preview: evt.preview ?? null, confirmed: true },
        );
      }
      yield evt;
    }
  }
  return sseResponse(run());
}
