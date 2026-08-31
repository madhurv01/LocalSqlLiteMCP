import type { AgentPlan, PlannedStatement, SchemaSnapshot } from "@/lib/types";
import type { LlmProvider, PlanCallbacks, PlanRequest } from "./types";
import { toCallbacks } from "./types";
import { assessScript } from "@/lib/sqlite/safety";

/**
 * Zero-dependency, offline natural-language planner. It recognises the most
 * common database operations and emits real SQL. Anything it cannot map is
 * surfaced honestly instead of guessing.
 */
export class HeuristicProvider implements LlmProvider {
  readonly name = "heuristic";
  isReady() {
    return true;
  }

  async plan(
    req: PlanRequest,
    cb?: PlanCallbacks | ((t: string) => void),
  ): Promise<AgentPlan> {
    const { onToken } = toCallbacks(cb);
    const say = (t: string) => onToken?.(t);
    const msg = req.message.trim();
    const lower = msg.toLowerCase();
    say("Parsing your request locally with the built-in planner…\n");

    const statements: PlannedStatement[] = [];
    const verifications: AgentPlan["verifications"] = [];
    const notes: string[] = [];

    // ---- CREATE TABLE ---------------------------------------------------
    const createMatch = lower.match(
      /(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:table\s+(?:called\s+|named\s+)?)?["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table/,
    ) || lower.match(
      /(?:create|make)\s+(?:a\s+)?table\s+(?:called\s+|named\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );

    if (createMatch) {
      const table = createMatch[1];
      const cols = parseColumnList(msg);
      const columnDefs = cols.length
        ? cols.map(columnDefinition)
        : ['"id" INTEGER PRIMARY KEY AUTOINCREMENT'];
      if (cols.length && !cols.some((c) => /^id$/i.test(c))) {
        columnDefs.unshift('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
      }
      const ddl = `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${columnDefs.join(",\n  ")}\n)`;
      statements.push({
        sql: ddl,
        kind: "create",
        rationale: `Create table "${table}" with columns: ${columnDefs
          .map((d) => d.split('"')[1])
          .join(", ")}.`,
        tables: [table],
        destructive: false,
      });
      say(`Planned CREATE TABLE "${table}".\n`);
      verifications.push({
        description: `Table "${table}" exists`,
        sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
      });

      // ---- optional INSERT sample rows --------------------------------
      const insertCount = extractRowCount(lower);
      if (insertCount && /(insert|add|seed|populate|sample|dummy|fake|test)/.test(lower)) {
        const insertCols = (cols.length ? cols : ["name"]).filter((c) => !/^id$/i.test(c));
        const rows = Array.from({ length: insertCount }, (_, i) =>
          insertCols.map((c) => sampleValue(c, i)),
        );
        const colList = insertCols.map((c) => `"${c}"`).join(", ");
        const valuesSql = rows
          .map((r) => `(${r.join(", ")})`)
          .join(",\n  ");
        statements.push({
          sql: `INSERT INTO "${table}" (${colList}) VALUES\n  ${valuesSql}`,
          kind: "insert",
          rationale: `Insert ${insertCount} sample row(s) into "${table}".`,
          tables: [table],
          destructive: false,
        });
        verifications.push({
          description: `"${table}" has ${insertCount} rows`,
          sql: `SELECT COUNT(*) AS row_count FROM "${table}"`,
        });
        say(`Planned INSERT of ${insertCount} sample rows.\n`);
      }
      return finalize(msg, "Create schema objects and optionally seed data", statements, verifications, notes);
    }

    // ---- ADD COLUMN ---------------------------------------------------
    const addColMatch = lower.match(
      /add\s+(?:a\s+)?column\s+["'`]?([a-z_][a-z0-9_]*)["'`]?.*?\bto\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );
    if (addColMatch) {
      const [, col, table] = addColMatch;
      const type = inferType(col, lower);
      statements.push({
        sql: `ALTER TABLE "${table}" ADD COLUMN "${col}" ${type}`,
        kind: "alter",
        rationale: `Add column "${col}" (${type}) to "${table}".`,
        tables: [table],
        destructive: true,
      });
      verifications.push({
        description: `"${table}" now has column "${col}"`,
        sql: `SELECT 1 FROM pragma_table_info('${table}') WHERE name='${col}'`,
      });
      return finalize(msg, "Alter table structure", statements, verifications, notes);
    }

    // ---- RENAME COLUMN -------------------------------------------
    const rcA = lower.match(
      /rename\s+(?:the\s+)?column\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:in|on|of|from)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+to\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );
    const rcB = lower.match(
      /(?:in|on|of)\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?[,]?\s+rename\s+(?:the\s+)?column\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+to\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );
    const renameCol = rcA
      ? { from: rcA[1], table: rcA[2], to: rcA[3] }
      : rcB
        ? { table: rcB[1], from: rcB[2], to: rcB[3] }
        : null;
    if (renameCol) {
      const { table, from, to } = renameCol;
      statements.push({
        sql: `ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`,
        kind: "alter",
        rationale: `Rename column "${from}" to "${to}" on "${table}".`,
        tables: [table],
        destructive: true,
      });
      verifications.push({
        description: `"${table}" has column "${to}"`,
        sql: `SELECT 1 FROM pragma_table_info('${table}') WHERE name='${to}'`,
      });
      return finalize(msg, "Rename column", statements, verifications, notes);
    }

    // ---- RENAME TABLE -------------------------------------------
    const renameTableMatch =
      lower.match(
        /(?:rename|alter)\s+(?:the\s+)?table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as|into)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
      ) ||
      lower.match(
        /rename\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table\s+(?:to|as|into)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
      ) ||
      lower.match(
        /rename\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as|into)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
      );
    if (
      renameTableMatch &&
      req.schema.tables.some((t) => t.name === renameTableMatch[1])
    ) {
      const [, from, to] = renameTableMatch;
      statements.push({
        sql: `ALTER TABLE "${from}" RENAME TO "${to}"`,
        kind: "alter",
        rationale: `Rename table "${from}" to "${to}".`,
        tables: [from, to],
        destructive: true,
      });
      verifications.push({
        description: `Table "${to}" exists and "${from}" does not`,
        sql: `SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${to}') AS renamed_present`,
      });
      notes.push(
        `Views, triggers and foreign keys referencing "${from}" by name may need manual updates.`,
      );
      return finalize(msg, "Rename table", statements, verifications, notes);
    }

    // ---- INSERT into existing table --------------------------------
    const insMatch = lower.match(
      /(?:insert|add|seed|populate)\s+(\d+)?\s*(?:sample|dummy|fake|test|random)?\s*(?:rows?|records?|users?|entries?|items?)?\s+(?:in(?:to)?|to)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );
    if (insMatch) {
      const count = insMatch[1] ? parseInt(insMatch[1], 10) : extractRowCount(lower) ?? 5;
      const table = insMatch[2];
      const known = req.schema.tables.find((t) => t.name === table);
      const insertCols = known
        ? known.columns.filter((c) => !(c.primaryKey && /INT/i.test(c.type))).map((c) => c.name)
        : ["name"];
      const rows = Array.from({ length: count }, (_, i) =>
        insertCols.map((c) => sampleValue(c, i)),
      );
      statements.push({
        sql: `INSERT INTO "${table}" (${insertCols.map((c) => `"${c}"`).join(", ")}) VALUES\n  ${rows
          .map((r) => `(${r.join(", ")})`)
          .join(",\n  ")}`,
        kind: "insert",
        rationale: `Insert ${count} row(s) into "${table}".`,
        tables: [table],
        destructive: false,
      });
      verifications.push({
        description: `Row count of "${table}"`,
        sql: `SELECT COUNT(*) AS row_count FROM "${table}"`,
      });
      return finalize(msg, "Insert rows", statements, verifications, notes);
    }

    // ---- DROP TABLE -------------------------------------------------
    const dropMatch = lower.match(/drop\s+(?:the\s+)?table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
      lower.match(/delete\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table/);
    if (dropMatch) {
      const table = dropMatch[1];
      statements.push({
        sql: `DROP TABLE IF EXISTS "${table}"`,
        kind: "drop",
        rationale: `Permanently drop table "${table}" and all its data.`,
        tables: [table],
        destructive: true,
      });
      verifications.push({
        description: `"${table}" no longer exists`,
        sql: `SELECT COUNT(*) AS still_present FROM sqlite_master WHERE type='table' AND name='${table}'`,
      });
      notes.push("This is irreversible without the automatic snapshot.");
      return finalize(msg, "Drop table", statements, verifications, notes);
    }

    // ---- DELETE ROWS ---------------------------------------------
    const delMatch = lower.match(
      /delete\s+(?:all\s+)?(?:rows?\s+)?from\s+["'`]?([a-z_][a-z0-9_]*)["'`]?(.*)$/,
    );
    if (delMatch) {
      const table = delMatch[1];
      const rest = delMatch[2].trim();
      const where = rest.replace(/^where\s+/i, "").trim();
      const sql = where
        ? `DELETE FROM "${table}" WHERE ${where}`
        : `DELETE FROM "${table}"`;
      statements.push({
        sql,
        kind: "delete",
        rationale: where
          ? `Delete rows from "${table}" matching: ${where}.`
          : `Delete every row from "${table}".`,
        tables: [table],
        destructive: true,
      });
      verifications.push({
        description: `Remaining rows in "${table}"`,
        sql: `SELECT COUNT(*) AS remaining FROM "${table}"`,
      });
      return finalize(msg, "Delete rows", statements, verifications, notes);
    }

    // ---- READ / SELECT -----------------------------------------
    const countMatch = lower.match(/how\s+many\s+.*?\b(?:in|from)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
      lower.match(/count\s+(?:the\s+)?(?:rows?\s+)?(?:in|of|from)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/);
    if (countMatch) {
      const table = countMatch[1];
      statements.push({
        sql: `SELECT COUNT(*) AS count FROM "${table}"`,
        kind: "read",
        rationale: `Count rows in "${table}".`,
        tables: [table],
        destructive: false,
      });
      return finalize(msg, "Read data", statements, verifications, notes);
    }

    const showMatch = lower.match(
      /(?:show|list|display|get|select|fetch|find)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:rows?\s+|records?\s+|data\s+)?(?:from|in|of)?\s*["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    );
    if (showMatch && req.schema.tables.some((t) => t.name === showMatch[1])) {
      const table = showMatch[1];
      const limit = extractRowCount(lower) ?? 100;
      statements.push({
        sql: `SELECT * FROM "${table}" LIMIT ${limit}`,
        kind: "read",
        rationale: `Preview up to ${limit} rows from "${table}".`,
        tables: [table],
        destructive: false,
      });
      return finalize(msg, "Read data", statements, verifications, notes);
    }

    // ---- Raw SQL pasted directly -------------------------------
    if (/^\s*(select|with|insert|update|delete|create|alter|drop|pragma)\b/i.test(msg)) {
      const report = assessScript([msg]);
      report.perStatement.forEach((s) =>
        statements.push({
          sql: s.sql,
          kind: s.kind,
          rationale: "Execute SQL exactly as provided.",
          tables: [],
          destructive: s.destructive,
        }),
      );
      notes.push("Running SQL you supplied verbatim.");
      return finalize(msg, "Execute provided SQL", statements, verifications, notes);
    }

    // ---- Give up honestly --------------------------------------
    say("The built-in planner could not map this request to SQL.\n");
    return {
      summary:
        "I couldn't translate that into a concrete SQL plan with the offline planner. " +
        "Try phrasing it as an operation, e.g. \"create a products table with name, price\", " +
        "\"insert 20 sample rows into products\", \"show all users\", or paste SQL directly. " +
        "For free natural-language planning of arbitrary requests, set LLM_PROVIDER=ollama.",
      intent: "clarification-needed",
      statements: [],
      verifications: [],
      requiresConfirmation: false,
      risk: "safe",
      notes,
    };
  }
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function finalize(
  message: string,
  intent: string,
  statements: PlannedStatement[],
  verifications: AgentPlan["verifications"],
  notes: string[],
): AgentPlan {
  const report = assessScript(statements.map((s) => s.sql));
  return {
    summary: describePlan(statements),
    intent,
    statements,
    verifications,
    requiresConfirmation: report.requiresConfirmation,
    risk: report.risk,
    notes: [...notes, ...report.warnings.filter((w) => !notes.includes(w))],
  };
}

function describePlan(statements: PlannedStatement[]): string {
  if (!statements.length) return "No changes.";
  return statements.map((s, i) => `${i + 1}. ${s.rationale}`).join(" ");
}

function parseColumnList(msg: string): string[] {
  // "with id, name, email" / "columns: a, b, c" / "having x and y"
  const m = msg.match(/\b(?:with|columns?|containing|having|fields?)\b[:\s]+([a-zA-Z0-9_,\s()]+?)(?:\s+and\s+insert|\.|$)/i);
  if (!m) return [];
  return m[1]
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.trim().replace(/[^a-zA-Z0-9_]/g, ""))
    .filter(Boolean)
    .slice(0, 40);
}

function extractRowCount(lower: string): number | undefined {
  const m = lower.match(/\b(\d{1,5})\b\s*(?:sample|dummy|fake|test|random)?\s*(?:rows?|records?|users?|entries?|items?|customers?|products?|orders?)?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 100000) return n;
  }
  const words: Record<string, number> = { ten: 10, five: 5, twenty: 20, fifty: 50, hundred: 100, three: 3 };
  for (const [w, n] of Object.entries(words)) if (lower.includes(w)) return n;
  return undefined;
}

function inferType(col: string, ctx: string): string {
  const c = col.toLowerCase();
  if (/(_id$|^id$)/.test(c)) return "INTEGER";
  if (/(count|qty|quantity|age|number|num|year|stock|score|rank)/.test(c)) return "INTEGER";
  if (/(price|amount|total|cost|rate|balance|lat|lng|longitude|latitude)/.test(c)) return "REAL";
  if (/(is_|has_|active|enabled|deleted|verified)/.test(c)) return "INTEGER";
  if (/(created_at|updated_at|date|_at$|timestamp|time)/.test(c)) return "TEXT";
  if (ctx.includes(`${c} as integer`)) return "INTEGER";
  return "TEXT";
}

function columnDefinition(col: string): string {
  const clean = col.replace(/[^a-zA-Z0-9_]/g, "");
  if (/^id$/i.test(clean)) return `"${clean}" INTEGER PRIMARY KEY AUTOINCREMENT`;
  const type = inferType(clean, "");
  const notNull = /(name|email|title)/i.test(clean) ? " NOT NULL" : "";
  const dflt = /(created_at|updated_at)/i.test(clean)
    ? " DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    : "";
  const unique = /^email$/i.test(clean) ? " UNIQUE" : "";
  return `"${clean}" ${type}${notNull}${unique}${dflt}`;
}

const FIRST = ["Ava", "Liam", "Noah", "Emma", "Oliver", "Mia", "Ethan", "Sophia", "Lucas", "Isla", "Leo", "Zoe", "Kai", "Nora", "Ivy"];
const LAST = ["Smith", "Johnson", "Lee", "Patel", "Garcia", "Nguyen", "Brown", "Kim", "Davis", "Lopez", "Khan", "Silva"];
const DOMAINS = ["example.com", "mail.test", "acme.dev", "demo.io"];
const CITIES = ["Austin", "Berlin", "Denver", "Lisbon", "Osaka", "Nairobi", "Bogota", "Oslo"];
const PRODUCTS = ["Widget", "Gadget", "Sprocket", "Cog", "Bolt", "Lever", "Piston", "Valve"];

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sampleValue(col: string, i: number): string {
  const c = col.toLowerCase();
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 7) % LAST.length];
  if (/^id$/.test(c) || /_id$/.test(c)) return String(i + 1);
  if (/(full_?name|^name$|display_?name)/.test(c)) return sqlStr(`${first} ${last}`);
  if (/first_?name/.test(c)) return sqlStr(first);
  if (/last_?name|surname/.test(c)) return sqlStr(last);
  if (/email/.test(c)) return sqlStr(`${first.toLowerCase()}.${last.toLowerCase()}${i}@${DOMAINS[i % DOMAINS.length]}`);
  if (/user_?name|handle|slug/.test(c)) return sqlStr(`${first.toLowerCase()}_${i}`);
  if (/phone/.test(c)) return sqlStr(`+1-555-01${String(10 + (i % 90)).padStart(2, "0")}`);
  if (/city|location/.test(c)) return sqlStr(CITIES[i % CITIES.length]);
  if (/country/.test(c)) return sqlStr("US");
  if (/address/.test(c)) return sqlStr(`${100 + i} Main St`);
  if (/(title|product|item)/.test(c)) return sqlStr(`${PRODUCTS[i % PRODUCTS.length]} ${i + 1}`);
  if (/(description|bio|notes?|comment)/.test(c)) return sqlStr(`Sample ${c} #${i + 1}`);
  if (/(price|amount|total|cost|balance)/.test(c)) return (Math.round((5 + i * 3.5) * 100) / 100).toString();
  if (/(rate|ratio|score)/.test(c)) return (Math.round((i % 5) * 0.2 * 100) / 100).toString();
  if (/(age)/.test(c)) return String(18 + (i % 50));
  if (/(count|qty|quantity|stock|number|num)/.test(c)) return String((i % 20) + 1);
  if (/(year)/.test(c)) return String(2000 + (i % 25));
  if (/(is_|has_|active|enabled|verified|deleted)/.test(c)) return String(i % 2);
  if (/(status|state)/.test(c)) return sqlStr(["active", "pending", "archived"][i % 3]);
  if (/(created_at|updated_at|_at$|date|timestamp)/.test(c)) {
    const d = new Date(Date.now() - i * 86400000).toISOString();
    return sqlStr(d);
  }
  if (/(uuid|guid|token)/.test(c)) return sqlStr(`id-${i + 1}-${Math.random().toString(36).slice(2, 8)}`);
  return sqlStr(`${col}_${i + 1}`);
}
