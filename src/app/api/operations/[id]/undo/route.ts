import { repo } from "@/lib/repo";
import { undoOperation } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = undoOperation(id);
  if (result.ok) {
    const op = repo.getOperation(id);
    if (op?.conversationId) {
      repo.addMessage(op.conversationId, "assistant", `↩︎ ${result.message}`, {
        operationId: id,
        rolledBack: true,
      });
    }
  }
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
