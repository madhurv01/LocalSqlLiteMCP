import type { AgentPlan, SchemaSnapshot } from "@/lib/types";

export interface PlanRequest {
  message: string;
  schema: SchemaSnapshot;
  history: { role: "user" | "assistant"; content: string }[];
}

export interface PlanChunk {
  /** Streamed natural-language reasoning shown token-by-token in the UI. */
  text: string;
}

export interface PlanCallbacks {
  /** Streamed natural-language reasoning, token by token. */
  onToken?: (t: string) => void;
  /** A SQL statement as soon as the planner has fully drafted it. */
  onStatement?: (sql: string, index: number) => void;
}

export interface LlmProvider {
  readonly name: string;
  /** True when the provider can actually run (key present, reachable, ...). */
  isReady(): Promise<boolean> | boolean;
  /**
   * Produce a plan. Implementations may stream reasoning via `onToken` and
   * drafted SQL via `onStatement` before returning the final structured plan.
   */
  plan(req: PlanRequest, cb?: PlanCallbacks | ((t: string) => void)): Promise<AgentPlan>;
}

/** Normalise the legacy `(t) => void` second arg into PlanCallbacks. */
export function toCallbacks(cb?: PlanCallbacks | ((t: string) => void)): PlanCallbacks {
  if (!cb) return {};
  return typeof cb === "function" ? { onToken: cb } : cb;
}

export class PlanParseError extends Error {}
