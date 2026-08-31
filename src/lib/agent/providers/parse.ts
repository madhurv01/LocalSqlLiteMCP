import { z } from "zod";
import type { AgentPlan } from "@/lib/types";
import { assessScript } from "@/lib/sqlite/safety";
import { PlanParseError } from "./types";

const planSchema = z.object({
  summary: z.string(),
  intent: z.string().default("operation"),
  risk: z.enum(["safe", "low", "moderate", "high", "critical"]).default("low"),
  requiresConfirmation: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
  statements: z
    .array(
      z.object({
        sql: z.string().min(1),
        kind: z
          .enum(["read", "insert", "update", "delete", "create", "alter", "drop", "pragma", "transaction", "unknown"])
          .default("unknown"),
        rationale: z.string().default(""),
        tables: z.array(z.string()).default([]),
        destructive: z.boolean().default(false),
      }),
    )
    .default([]),
  verifications: z
    .array(z.object({ description: z.string(), sql: z.string().min(1) }))
    .default([]),
});

/** Pull the first balanced JSON object out of an LLM response. */
export function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  if (start === -1) throw new PlanParseError("No JSON object in model output.");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new PlanParseError("Unbalanced JSON in model output.");
}

/** Extract fully-formed `"sql": "..."` values from a partial JSON stream. */
export function scanSqlDrafts(full: string): string[] {
  const out: string[] = [];
  const re = /"sql"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(full))) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      /* ignore half-escaped */
    }
  }
  return out;
}

export function parsePlan(raw: string): AgentPlan {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    throw new PlanParseError(`Could not parse plan JSON: ${(err as Error).message}`);
  }
  const parsed = planSchema.parse(json);

  // Re-derive risk/confirmation from our own static analysis — never trust the model.
  const report = assessScript(parsed.statements.map((s) => s.sql));
  return {
    ...parsed,
    risk: worseRisk(parsed.risk, report.risk),
    requiresConfirmation: parsed.requiresConfirmation || report.requiresConfirmation,
    notes: [...parsed.notes, ...report.warnings.filter((w) => !parsed.notes.includes(w))],
  };
}

function worseRisk(a: string, b: string): AgentPlan["risk"] {
  const order = ["safe", "low", "moderate", "high", "critical"] as const;
  return order[Math.max(order.indexOf(a as never), order.indexOf(b as never))] ?? "low";
}
