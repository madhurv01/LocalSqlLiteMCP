import { NextRequest } from "next/server";
import { repo } from "@/lib/repo";
import { undoOperation } from "@/lib/agent/orchestrator";
import { authGate } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await authGate(req);
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  const op = repo.getOwnedOperation(id, gate.id);
  if (!op) return Response.json({ error: "Not found" }, { status: 404 });

  const result = undoOperation(id);
  if (result.ok && op.conversationId) {
    repo.addMessage(op.conversationId, "assistant", `↩︎ ${result.message}`, {
      operationId: id,
      rolledBack: true,
    });
  }
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
