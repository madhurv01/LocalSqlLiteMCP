import type { SchemaSnapshot } from "@/lib/types";

export function schemaToText(schema: SchemaSnapshot): string {
  if (!schema.tables.length) return "(the database is currently empty — no tables)";
  return schema.tables
    .map((t) => {
      const cols = t.columns
        .map(
          (c) =>
            `${c.name} ${c.type}${c.primaryKey ? " PK" : ""}${c.notNull ? " NOT NULL" : ""}`,
        )
        .join(", ");
      return `- ${t.name} (${t.rowCount} rows): ${cols}`;
    })
    .join("\n");
}

export const SYSTEM_PROMPT = `You are the planning core of LocalDB Agent, a careful SQLite database operator.
Given a user request and the current schema, produce a concrete execution plan.

Rules:
- Output ONLY valid SQLite SQL in statements. No MySQL/Postgres syntax.
- Prefer IF NOT EXISTS / IF EXISTS guards.
- Never include ATTACH DATABASE, load_extension, or PRAGMA writable_schema.
- For destructive changes (UPDATE/DELETE without a tight WHERE, DROP, ALTER that removes data) set requiresConfirmation true.
- Always add at least one verification query (a SELECT) that proves the change worked.
- Keep INSERT sample data realistic and consistent with column names.
- If the request is ambiguous or unsafe, return an empty statements array and explain in summary.

Respond with a single JSON object, no markdown fences, matching:
{
  "summary": string,
  "intent": string,
  "risk": "safe" | "low" | "moderate" | "high" | "critical",
  "requiresConfirmation": boolean,
  "notes": string[],
  "statements": [{ "sql": string, "kind": "read"|"insert"|"update"|"delete"|"create"|"alter"|"drop"|"pragma", "rationale": string, "tables": string[], "destructive": boolean }],
  "verifications": [{ "description": string, "sql": string }]
}`;

export function buildUserPrompt(message: string, schema: SchemaSnapshot): string {
  return `Current schema:\n${schemaToText(schema)}\n\nUser request:\n${message}`;
}
