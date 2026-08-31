import type {
  AgentEvent,
  AgentPlan,
  ExecutionResult,
  PreviewResult,
  StageEvent,
} from "@/lib/types";

export interface DryRunData {
  statements: { sql: string; kind: string; destructive: boolean; warnings: string[] }[];
  risk: string;
  requiresConfirmation: boolean;
  destructiveStatements: number;
  warnings: string[];
  affectedTables: string[];
}

export interface AgentTurn {
  id: string;
  status: "streaming" | "awaiting_confirmation" | "executing" | "done" | "error" | "cancelled";
  reasoning: string;
  stages: StageEvent[];
  /** SQL drafted by the planner, streamed statement-by-statement. */
  draftSql: string[];
  plan: AgentPlan | null;
  dryRun: DryRunData | null;
  preview: PreviewResult | null;
  operationId: string | null;
  result: ExecutionResult | null;
  error: { message: string; hint?: string } | null;
}

export function emptyTurn(id: string): AgentTurn {
  return {
    id,
    status: "streaming",
    reasoning: "",
    stages: [],
    draftSql: [],
    plan: null,
    dryRun: null,
    preview: null,
    operationId: null,
    result: null,
    error: null,
  };
}

export function reduceTurn(turn: AgentTurn, evt: AgentEvent | { type: "end" }): AgentTurn {
  switch (evt.type) {
    case "token":
      return { ...turn, reasoning: turn.reasoning + evt.text };
    case "sql": {
      const draftSql = [...turn.draftSql];
      draftSql[evt.index] = evt.text;
      return { ...turn, draftSql };
    }
    case "stage": {
      const stages = [...turn.stages, evt];
      const patch: Partial<AgentTurn> = { stages };
      if (evt.stage === "plan" && evt.status === "done" && evt.data) {
        patch.plan = (evt.data as { plan?: AgentPlan }).plan ?? turn.plan;
      }
      if (evt.stage === "preview" && evt.data) {
        const d = evt.data as { preview?: PreviewResult; dryRun?: DryRunData };
        if (d.preview) patch.preview = d.preview;
        if (d.dryRun) patch.dryRun = d.dryRun;
      }
      if (evt.stage === "confirm" && evt.data) {
        const d = evt.data as { preview?: PreviewResult };
        if (d.preview) patch.preview = d.preview;
      }
      if (evt.stage === "execute" && evt.status === "start") patch.status = "executing";
      if (evt.status === "error") patch.status = "error";
      return { ...turn, ...patch };
    }
    case "done": {
      return {
        ...turn,
        plan: evt.plan ?? turn.plan,
        preview: evt.preview ?? turn.preview,
        operationId: evt.operationId,
        result: evt.result ?? turn.result,
        status: evt.awaitingConfirmation
          ? "awaiting_confirmation"
          : turn.status === "error"
            ? "error"
            : "done",
      };
    }
    case "error":
      return { ...turn, status: "error", error: { message: evt.message, hint: evt.hint } };
    case "end":
      return turn.status === "streaming" ? { ...turn, status: "done" } : turn;
    default:
      return turn;
  }
}

/** Rebuild a turn from a persisted assistant message meta blob. */
export function turnFromMeta(id: string, meta: Record<string, unknown> | null): AgentTurn | null {
  if (!meta) return null;
  const t = emptyTurn(id);
  t.reasoning = (meta.reasoning as string) ?? "";
  t.stages = (meta.stages as StageEvent[]) ?? [];
  t.plan = (meta.plan as AgentPlan) ?? null;
  t.preview = (meta.preview as PreviewResult) ?? null;
  t.operationId = (meta.operationId as string) ?? null;
  t.result = (meta.result as ExecutionResult) ?? null;
  t.draftSql = t.plan ? t.plan.statements.map((s) => s.sql) : [];
  t.status = meta.awaitingConfirmation
    ? "awaiting_confirmation"
    : meta.cancelled
      ? "cancelled"
      : "done";
  return t;
}
