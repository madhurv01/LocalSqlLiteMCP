import type { AgentPlan, PlannedStatement, SchemaSnapshot } from "@/lib/types";
import type { LlmProvider, PlanCallbacks, PlanRequest } from "./types";
import { toCallbacks } from "./types";
import { assessScript } from "@/lib/sqlite/safety";

interface Ctx {
  msg: string;
  lower: string;
  schema: SchemaSnapshot;
  statements: PlannedStatement[];
  verifications: AgentPlan["verifications"];
  notes: string[];
}

type Handler = (c: Ctx) => { intent: string } | null;

/**
 * Zero-dependency, offline natural-language planner. It recognises a broad set
 * of common database operations and emits real SQLite SQL. Anything it cannot
 * map is surfaced honestly instead of guessing.
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
    say("Parsing your request locally with the built-in planner…\n");

    const c: Ctx = {
      msg: req.message.trim(),
      lower: req.message.trim().toLowerCase(),
      schema: req.schema,
      statements: [],
      verifications: [],
      notes: [],
    };

    // Ordered — first handler that returns wins.
    const handlers: Handler[] = [
      rawSql,
      listTables,
      describeTable,
      countRows,
      renameTable,
      renameColumn,
      dropColumn,
      addColumn,
      createTable,
      dropTable,
      insertRows,
      updateRows,
      deleteRows,
      selectRows,
    ];

    for (const h of handlers) {
      const res = h(c);
      if (res) {
        say(
          c.statements.length
            ? `Planned ${c.statements.map((s) => s.kind.toUpperCase()).join(" + ")}.\n`
            : "",
        );
        return finalize(res.intent, c);
      }
    }

    say("The built-in planner could not map this request to SQL.\n");
    return {
      summary:
        "I couldn't translate that into a concrete SQL plan with the offline planner. " +
        "Try an operation like \"list all tables\", \"describe customers\", " +
        "\"create a products table with name, price and 20 sample rows\", " +
        "\"show customers where city = 'Berlin'\", \"rename table orders to sales\", " +
        'or paste SQL directly. For open-ended natural-language planning set LLM_PROVIDER=ollama.',
      intent: "clarification-needed",
      statements: [],
      verifications: [],
      requiresConfirmation: false,
      risk: "safe",
      notes: c.notes,
    };
  }
}

// ==========================================================================
// intent handlers
// ==========================================================================

const RAW_SQL_SHAPES: RegExp[] = [
  /^\s*select\s+[\s\S]+?\s+from\s+/i,
  /^\s*select\s+\d/i, // SELECT 1, SELECT COUNT(*) ...
  /^\s*with\s+[\w"]+\s+as\s*\(/i,
  /^\s*insert\s+into\s+[\w"'`]+/i,
  /^\s*update\s+[\w"'`]+\s+set\s+/i,
  /^\s*delete\s+from\s+[\w"'`]+/i,
  /^\s*create\s+(temp\s+|temporary\s+|unique\s+)?(table|index|view|trigger|virtual\s+table)\s+/i,
  /^\s*alter\s+table\s+[\w"'`]+\s+(add|drop|rename)\b/i,
  /^\s*drop\s+(table|index|view|trigger)\s+/i,
  /^\s*pragma\s+\w+/i,
  /^\s*explain\s+/i,
  /^\s*(begin|commit|rollback|vacuum|analyze|reindex)\b/i,
];

function rawSql(c: Ctx): { intent: string } | null {
  if (!RAW_SQL_SHAPES.some((re) => re.test(c.msg))) return null;
  const report = assessScript([c.msg]);
  for (const s of report.perStatement) {
    c.statements.push({
      sql: s.sql,
      kind: s.kind,
      rationale: "Execute the SQL you provided, unchanged.",
      tables: [],
      destructive: s.destructive,
    });
  }
  c.notes.push("Running SQL you supplied verbatim.");
  return { intent: "Execute provided SQL" };
}

const MUTATION_VERB = /\b(create|make|build|generate|set up|add|insert|seed|populate|fill|drop|delete|remove|destroy|rename|update|alter|modify)\b/;

function listTables(c: Ctx): { intent: string } | null {
  // Any DDL/DML request is handled by a dedicated handler, not by listing.
  if (MUTATION_VERB.test(c.lower)) return null;

  const wantsTables =
    /\btables?\b/.test(c.lower) &&
    /\b(list|show|display|get|give|see|what|which|all|how many|enumerate|tell me|name[sd]?)\b/.test(
      c.lower,
    );
  const wantsSchema =
    /\b(schema|structure|overview|layout|erd)\b/.test(c.lower) &&
    /\b(database|db|whole|entire|full|show|describe|the)\b/.test(c.lower) &&
    !mentionsKnownTable(c); // "schema of customers" handled by describeTable

  if (!wantsTables && !wantsSchema) return null;

  if (/\bhow many tables\b/.test(c.lower) || /\bnumber of tables\b/.test(c.lower)) {
    c.statements.push({
      sql: "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      kind: "read",
      rationale: "Count user tables in the database.",
      tables: ["sqlite_master"],
      destructive: false,
    });
    return { intent: "Read schema" };
  }

  c.statements.push({
    sql: "SELECT name AS table_name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    kind: "read",
    rationale: "List every table and view in the database.",
    tables: ["sqlite_master"],
    destructive: false,
  });
  return { intent: "Read schema" };
}

function describeTable(c: Ctx): { intent: string } | null {
  // Dedicated handlers own create/alter/insert/… — don't shadow them.
  if (MUTATION_VERB.test(c.lower)) return null;
  const trigger =
    /\bdescribe\b/.test(c.lower) ||
    /\b(columns?|fields?|structure|schema|definition|ddl)\s+(of|for|in|on)\b/.test(c.lower) ||
    /\b(what|which|show me|list|tell me)\b.*\b(columns?|fields?|structure|schema)\b/.test(c.lower);
  if (!trigger) return null;
  const table = matchKnownTable(c);
  if (!table) return null;

  if (/\b(ddl|create statement|definition)\b/.test(c.lower)) {
    c.statements.push({
      sql: `SELECT sql FROM sqlite_master WHERE name = '${table}'`,
      kind: "read",
      rationale: `Show the CREATE statement for "${table}".`,
      tables: [table],
      destructive: false,
    });
  } else {
    c.statements.push({
      sql: `SELECT name AS column_name, type, "notnull" AS not_null, pk AS primary_key, dflt_value AS default_value FROM pragma_table_info('${table}')`,
      kind: "read",
      rationale: `Describe the columns of "${table}".`,
      tables: [table],
      destructive: false,
    });
  }
  return { intent: "Describe table" };
}

function countRows(c: Ctx): { intent: string } | null {
  const m =
    c.lower.match(/how\s+many\s+(?:rows?|records?|entries?)\s+(?:are\s+)?(?:in|on|of|inside)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/\b(?:count|number of|total)\s+(?:the\s+)?(?:rows?|records?|entries?)?\s*(?:in|of|for|from)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/how\s+many\s+["'`]?([a-z_][a-z0-9_]*?)s?["'`]?\s*(?:are\s+there|do\s+(?:i|we)\s+have|\?|$)/);
  let table: string | null = m ? resolveTable(m[1], c.schema) : null;
  if (!table && /how many/.test(c.lower)) table = matchKnownTable(c);
  if (!table) return null;

  c.statements.push({
    sql: `SELECT COUNT(*) AS count FROM "${table}"`,
    kind: "read",
    rationale: `Count the rows in "${table}".`,
    tables: [table],
    destructive: false,
  });
  return { intent: "Count rows" };
}

function renameTable(c: Ctx): { intent: string } | null {
  const explicit =
    c.lower.match(/(?:rename|alter)\s+(?:the\s+)?table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as|into|->)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/rename\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table\s+(?:to|as|into|->)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/);
  const bare = c.lower.match(
    /rename\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as|into|->)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
  );
  const m = explicit || (bare && known(c.schema, bare[1]) ? bare : null);
  if (!m) return null;
  const [, from, to] = m;
  if (!known(c.schema, from)) {
    c.notes.push(`Table "${from}" was not found in the current schema — the rename may fail.`);
  }
  c.statements.push({
    sql: `ALTER TABLE "${from}" RENAME TO "${to}"`,
    kind: "alter",
    rationale: `Rename table "${from}" to "${to}".`,
    tables: [from, to],
    destructive: true,
  });
  c.verifications.push({
    description: `Table "${to}" exists after the rename`,
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='${to}'`,
  });
  c.notes.push(`Views/triggers/foreign keys referencing "${from}" by name may need manual updates.`);
  return { intent: "Rename table" };
}

function renameColumn(c: Ctx): { intent: string } | null {
  const a = c.lower.match(
    /rename\s+(?:the\s+)?(?:column|field)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:in|on|of|from)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
  );
  const b = c.lower.match(
    /(?:in|on|of|for)\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?,?\s+rename\s+(?:the\s+)?(?:column|field)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:to|as)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
  );
  const d = a
    ? { from: a[1], table: a[2], to: a[3] }
    : b
      ? { table: b[1], from: b[2], to: b[3] }
      : null;
  if (!d) return null;
  c.statements.push({
    sql: `ALTER TABLE "${d.table}" RENAME COLUMN "${d.from}" TO "${d.to}"`,
    kind: "alter",
    rationale: `Rename column "${d.from}" to "${d.to}" on "${d.table}".`,
    tables: [d.table],
    destructive: true,
  });
  c.verifications.push({
    description: `"${d.table}" now has a column "${d.to}"`,
    sql: `SELECT 1 FROM pragma_table_info('${d.table}') WHERE name='${d.to}'`,
  });
  return { intent: "Rename column" };
}

function dropColumn(c: Ctx): { intent: string } | null {
  const m =
    c.lower.match(/(?:drop|remove|delete)\s+(?:the\s+)?(?:column|field)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:from|in|on|of)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/(?:drop|remove|delete)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:column|field)\s+(?:from|in|on|of)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/);
  if (!m) return null;
  const [, col, table] = m;
  c.statements.push({
    sql: `ALTER TABLE "${table}" DROP COLUMN "${col}"`,
    kind: "alter",
    rationale: `Drop column "${col}" from "${table}" (its data is lost).`,
    tables: [table],
    destructive: true,
  });
  c.verifications.push({
    description: `"${table}" no longer has column "${col}"`,
    sql: `SELECT COUNT(*) AS still_present FROM pragma_table_info('${table}') WHERE name='${col}'`,
  });
  c.notes.push("Dropping a column permanently removes its data.");
  return { intent: "Drop column" };
}

function addColumn(c: Ctx): { intent: string } | null {
  const m =
    c.lower.match(/add\s+(?:a\s+)?(?:new\s+)?(?:column|field)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s*(?:of type\s+(\w+))?.*?\b(?:to|on|in)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/add\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+(?:as\s+a\s+)?(?:column|field)\s+(?:to|on|in)\s+["'`]?()([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/(?:create|introduce)\s+(?:a\s+)?(?:column|field)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?()\s+(?:in|on|for)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/);
  if (!m) return null;
  const col = m[1];
  const explicitType = (m[2] || "").toUpperCase();
  const table = m[3];
  const type = /^(TEXT|INTEGER|REAL|BLOB|NUMERIC|INT|BOOLEAN|DATE)$/.test(explicitType)
    ? explicitType
    : inferType(col, c.lower);
  c.statements.push({
    sql: `ALTER TABLE "${table}" ADD COLUMN "${col}" ${type}`,
    kind: "alter",
    rationale: `Add column "${col}" (${type}) to "${table}".`,
    tables: [table],
    destructive: true,
  });
  c.verifications.push({
    description: `"${table}" now has a column "${col}"`,
    sql: `SELECT 1 FROM pragma_table_info('${table}') WHERE name='${col}'`,
  });
  return { intent: "Add column" };
}

function createTable(c: Ctx): { intent: string } | null {
  if (!/\b(create|make|add|build|set up|generate)\b/.test(c.lower) || !/\btable\b/.test(c.lower)) {
    return null;
  }
  const table = extractNewTableName(c.lower);
  if (!table) return null;

  const cols = parseColumns(c.msg);
  const defs = cols.length ? cols.map(columnDefinition) : ['"id" INTEGER PRIMARY KEY AUTOINCREMENT'];
  if (cols.length && !cols.some((x) => /^id$/i.test(x))) {
    defs.unshift('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  }
  c.statements.push({
    sql: `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${defs.join(",\n  ")}\n)`,
    kind: "create",
    rationale: `Create table "${table}" with columns: ${defs.map((d) => d.split('"')[1]).join(", ")}.`,
    tables: [table],
    destructive: false,
  });
  c.verifications.push({
    description: `Table "${table}" exists`,
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
  });

  const wantsSeed = /\b(insert|fill|seed|populate|add|put|load|with)\b.*\b(rows?|records?|entries?|dummy|sample|fake|test|mock|data|users?|items?|customers?|products?)\b/.test(
    c.lower,
  );
  if (wantsSeed) {
    const count = extractRowCount(c.lower) ?? 10;
    const seedCols = (cols.length ? cols : ["name"]).filter((x) => !/^id$/i.test(x));
    const rows = Array.from({ length: count }, (_, i) => seedCols.map((col) => sampleValue(col, i)));
    c.statements.push({
      sql: `INSERT INTO "${table}" (${seedCols.map((x) => `"${x}"`).join(", ")}) VALUES\n  ${rows
        .map((r) => `(${r.join(", ")})`)
        .join(",\n  ")}`,
      kind: "insert",
      rationale: `Insert ${count} sample row(s) into "${table}".`,
      tables: [table],
      destructive: false,
    });
    c.verifications.push({
      description: `"${table}" has ${count} row(s)`,
      sql: `SELECT COUNT(*) AS row_count FROM "${table}"`,
    });
  }
  return { intent: "Create table" };
}

function dropTable(c: Ctx): { intent: string } | null {
  const m =
    c.lower.match(/drop\s+(?:the\s+)?table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/) ||
    c.lower.match(/(?:delete|remove|destroy|drop)\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table/);
  if (!m) return null;
  const table = m[1];
  c.statements.push({
    sql: `DROP TABLE IF EXISTS "${table}"`,
    kind: "drop",
    rationale: `Permanently drop table "${table}" and all of its data.`,
    tables: [table],
    destructive: true,
  });
  c.verifications.push({
    description: `"${table}" no longer exists`,
    sql: `SELECT COUNT(*) AS still_present FROM sqlite_master WHERE type='table' AND name='${table}'`,
  });
  c.notes.push("Irreversible except via the automatic snapshot.");
  return { intent: "Drop table" };
}

function insertRows(c: Ctx): { intent: string } | null {
  const m = c.lower.match(
    /(?:insert|add|seed|populate|put|load|generate)\s+(\d+)?\s*(?:more\s+)?(?:sample|dummy|fake|test|random|mock)?\s*(?:rows?|records?|entries?|items?|users?|customers?|products?|orders?)?\s+(?:in(?:to)?|to|for)\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?/,
  );
  if (!m) return null;
  const table = m[2];
  const known = c.schema.tables.find((t) => t.name === table);
  const count = m[1] ? parseInt(m[1], 10) : extractRowCount(c.lower) ?? 5;
  const cols = known
    ? known.columns
        .filter((col) => !(col.primaryKey && /INT/i.test(col.type)))
        .map((col) => col.name)
    : ["name"];
  const rows = Array.from({ length: count }, (_, i) => cols.map((col) => sampleValue(col, i)));
  c.statements.push({
    sql: `INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(", ")}) VALUES\n  ${rows
      .map((r) => `(${r.join(", ")})`)
      .join(",\n  ")}`,
    kind: "insert",
    rationale: `Insert ${count} row(s) into "${table}".`,
    tables: [table],
    destructive: false,
  });
  c.verifications.push({
    description: `Row count of "${table}"`,
    sql: `SELECT COUNT(*) AS row_count FROM "${table}"`,
  });
  return { intent: "Insert rows" };
}

function updateRows(c: Ctx): { intent: string } | null {
  let table: string | undefined;
  let assignments: string | undefined;
  let where: string | undefined;

  const direct = c.msg.match(/update\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s+set\s+([\s\S]+?)(?:\s+where\s+([\s\S]+))?$/i);
  if (direct) {
    [, table, assignments, where] = direct;
  } else {
    const nl = c.msg.match(
      /set\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?\s*(?:=|to)\s*("[^"]*"|'[^']*'|[^\s]+)\s+(?:in|on|for|of)\s+(?:the\s+)?["'`]?([a-z_][a-z0-9_]*)["'`]?(?:\s+where\s+([\s\S]+))?/i,
    );
    if (nl) {
      const col = nl[1];
      const val = /^['"]/.test(nl[2]) ? nl[2].replace(/^"|"$/g, "'") : sqlLiteral(nl[2]);
      table = nl[3];
      assignments = `"${col}" = ${val}`;
      where = nl[4];
    }
  }
  if (!table || !assignments) return null;

  const sql = where
    ? `UPDATE "${table}" SET ${assignments.trim()} WHERE ${where.trim()}`
    : `UPDATE "${table}" SET ${assignments.trim()}`;
  c.statements.push({
    sql,
    kind: "update",
    rationale: where
      ? `Update "${table}" rows matching ${where.trim()}.`
      : `Update every row in "${table}".`,
    tables: [table],
    destructive: true,
  });
  c.verifications.push({
    description: `Sample of "${table}" after the update`,
    sql: `SELECT * FROM "${table}"${where ? ` WHERE ${where.trim()}` : ""} LIMIT 5`,
  });
  return { intent: "Update rows" };
}

function deleteRows(c: Ctx): { intent: string } | null {
  const m = c.msg.match(
    /delete\s+(?:all\s+)?(?:the\s+)?(?:rows?\s+|records?\s+)?from\s+["'`]?([a-z_][a-z0-9_]*)["'`]?([\s\S]*)$/i,
  );
  if (!m) return null;
  const table = m[1];
  const where = m[2].trim().replace(/^where\s+/i, "").trim();
  c.statements.push({
    sql: where ? `DELETE FROM "${table}" WHERE ${where}` : `DELETE FROM "${table}"`,
    kind: "delete",
    rationale: where
      ? `Delete rows from "${table}" matching: ${where}.`
      : `Delete every row from "${table}".`,
    tables: [table],
    destructive: true,
  });
  c.verifications.push({
    description: `Remaining rows in "${table}"`,
    sql: `SELECT COUNT(*) AS remaining FROM "${table}"`,
  });
  return { intent: "Delete rows" };
}

function selectRows(c: Ctx): { intent: string } | null {
  if (!/\b(show|list|display|get|give|see|fetch|find|select|view|browse|read|preview)\b/.test(c.lower)) {
    return null;
  }
  const table = matchKnownTable(c);
  if (!table) return null;

  let where = "";
  const whereM = c.msg.match(/\bwhere\s+([\s\S]+?)(?:\s+limit\s+\d+)?$/i);
  if (whereM) {
    where = whereM[1].trim();
  } else {
    // "customers in Berlin" / "orders with status shipped"
    const known = c.schema.tables.find((t) => t.name === table);
    const inM = c.msg.match(
      new RegExp(`${table}\\s+(?:in|from|with|for|where)\\s+([A-Za-z0-9_'"@.\\- ]+?)(?:\\s+limit\\b|[.?]|$)`, "i"),
    );
    if (inM && known) {
      const raw = inM[1].trim();
      const eqM = raw.match(/^([a-z_][a-z0-9_]*)\s*(?:=|is|equals?)\s*(.+)$/i);
      if (eqM && known.columns.some((col) => col.name.toLowerCase() === eqM[1].toLowerCase())) {
        where = `"${eqM[1]}" = ${sqlLiteral(eqM[2].trim())}`;
      } else {
        const tiers = [
          /(city|town|location|place|country|region|state|province)/i,
          /(status|stage|phase|category|type|kind|role|tier|plan)/i,
          /(name|title|label)/i,
        ];
        let textCol: string | undefined;
        for (const tier of tiers) {
          const hit = known.columns.find((col) => tier.test(col.name));
          if (hit) {
            textCol = hit.name;
            break;
          }
        }
        if (textCol) where = `"${textCol}" = ${sqlLiteral(raw)}`;
      }
    }
  }

  const limit = extractRowCount(c.lower) ?? 100;
  c.statements.push({
    sql: `SELECT * FROM "${table}"${where ? ` WHERE ${where}` : ""} LIMIT ${limit}`,
    kind: "read",
    rationale: where
      ? `Read up to ${limit} rows from "${table}" where ${where}.`
      : `Preview up to ${limit} rows from "${table}".`,
    tables: [table],
    destructive: false,
  });
  return { intent: "Read data" };
}

// ==========================================================================
// helpers
// ==========================================================================

function finalize(intent: string, c: Ctx): AgentPlan {
  const report = assessScript(c.statements.map((s) => s.sql));
  return {
    summary: c.statements.length
      ? c.statements.map((s, i) => `${i + 1}. ${s.rationale}`).join(" ")
      : "No changes.",
    intent,
    statements: c.statements,
    verifications: c.verifications,
    requiresConfirmation: report.requiresConfirmation,
    risk: report.risk,
    notes: [...c.notes, ...report.warnings.filter((w) => !c.notes.includes(w))],
  };
}

function known(schema: SchemaSnapshot, name: string): boolean {
  return schema.tables.some((t) => t.name.toLowerCase() === name.toLowerCase());
}

/** Resolve a possibly-plural/near-miss token to an actual table name. */
function resolveTable(token: string, schema: SchemaSnapshot): string | null {
  const t = token.toLowerCase();
  const exact = schema.tables.find((x) => x.name.toLowerCase() === t);
  if (exact) return exact.name;
  const singularOrPlural = schema.tables.find(
    (x) => x.name.toLowerCase() === t.replace(/s$/, "") || `${x.name.toLowerCase()}s` === t,
  );
  return singularOrPlural?.name ?? null;
}

/** Find the first known table name mentioned anywhere in the message. */
function matchKnownTable(c: Ctx): string | null {
  const words = c.lower.match(/[a-z_][a-z0-9_]*/g) ?? [];
  for (const w of words) {
    const r = resolveTable(w, c.schema);
    if (r) return r;
  }
  return null;
}

function mentionsKnownTable(c: Ctx): boolean {
  return matchKnownTable(c) !== null;
}

const CREATE_STOPWORDS = new Set([
  "me", "a", "an", "the", "new", "table", "called", "named", "with", "having",
  "containing", "fields", "field", "columns", "column", "and", "please", "for",
  "of", "in", "to", "it", "that", "this",
]);

function extractNewTableName(lower: string): string | null {
  const patterns = [
    /table\s+(?:called|named)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    /(?:create|make|build|generate|set up)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/,
    /["'`]?([a-z_][a-z0-9_]*)["'`]?\s+table\b/,
    /table\s+["'`]?([a-z_][a-z0-9_]*)["'`]?\s*\(/,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m && !CREATE_STOPWORDS.has(m[1]) && !/^(with|and|of)$/.test(m[1])) return m[1];
  }
  return null;
}

const COL_STOPWORDS = new Set([
  "the", "a", "an", "and", "with", "fields", "field", "columns", "column",
  "named", "called", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "some", "these", "them", "it", "of", "having", "containing",
  "attributes", "attribute", "properties", "property", "each", "only",
]);

function parseColumns(msg: string): string[] {
  let capture: string | null = null;

  const paren = msg.match(/[a-z_][a-z0-9_]*\s*\(([^)]+)\)/i);
  if (paren) capture = paren[1];

  if (!capture) {
    const m = msg.match(
      /\b(?:with|having|containing|has|include[s]?)\b[^.]*?\b(?:columns?|fields?|attributes?|properties?)\b\s*(?:named|called|like|:|of|-)?\s*([a-z0-9_,\s]+?)(?:[.;]|\s+(?:and\s+)?(?:then\s+)?(?:fill|insert|seed|populate|add|put|load|with\s+\d)\b|$)/i,
    );
    if (m) capture = m[1];
  }
  if (!capture) {
    const m = msg.match(/\b(?:columns?|fields?)\s*(?:named|called|:|-)?\s*([a-z0-9_,\s]+?)(?:[.;]|\s+(?:and\s+)?(?:fill|insert|seed|populate)\b|$)/i);
    if (m) capture = m[1];
  }
  if (!capture) {
    const m = msg.match(/\bwith\s+([a-z0-9_,\s]+?)(?:[.;]|\s+(?:and\s+)?(?:fill|insert|seed|populate|add)\b|$)/i);
    if (m) capture = m[1];
  }
  if (!capture) return [];

  return capture
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""))
    .filter((s) => s && !COL_STOPWORDS.has(s) && !/^\d+$/.test(s))
    .slice(0, 40);
}

function extractRowCount(lower: string): number | undefined {
  const digits = lower.match(
    /\b(\d{1,6})\b\s*(?:more\s+)?(?:sample|dummy|fake|test|random|mock)?\s*(?:rows?|records?|entries?|items?|users?|customers?|products?|orders?|suppliers?|of\b)?/,
  );
  if (digits) {
    const n = parseInt(digits[1], 10);
    if (n > 0 && n <= 100000) return n;
  }
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, dozen: 12,
  };
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) return n;
  }
  return undefined;
}

function inferType(col: string, ctx: string): string {
  const c = col.toLowerCase();
  if (/(_id$|^id$)/.test(c)) return "INTEGER";
  if (/(count|qty|quantity|age|number|num|year|stock|score|rank|level|position|priority)/.test(c)) return "INTEGER";
  if (/(price|amount|total|cost|rate|balance|lat|lng|longitude|latitude|weight|height|percentage)/.test(c)) return "REAL";
  if (/(is_|has_|active|enabled|deleted|verified|archived)/.test(c)) return "INTEGER";
  if (/(created_at|updated_at|_at$|_date$|timestamp|datetime)/.test(c)) return "TEXT";
  if (new RegExp(`${c}\\s+(?:as|:)\\s+(integer|int|number)`).test(ctx)) return "INTEGER";
  if (new RegExp(`${c}\\s+(?:as|:)\\s+(real|float|decimal|double)`).test(ctx)) return "REAL";
  return "TEXT";
}

function columnDefinition(col: string): string {
  const clean = col.replace(/[^a-zA-Z0-9_]/g, "");
  if (/^id$/i.test(clean)) return `"${clean}" INTEGER PRIMARY KEY AUTOINCREMENT`;
  const type = inferType(clean, "");
  const notNull = /^(name|email|title|username|slug)$/i.test(clean) ? " NOT NULL" : "";
  const dflt = /(created_at|updated_at)/i.test(clean)
    ? " DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    : "";
  const unique = /^(email|username|slug|code)$/i.test(clean) ? " UNIQUE" : "";
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

/** Quote a bare user value unless it is already numeric or quoted. */
function sqlLiteral(v: string): string {
  const t = v.trim().replace(/[.;]+$/, "");
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^'.*'$/.test(t)) return t;
  if (/^".*"$/.test(t)) return `'${t.slice(1, -1).replace(/'/g, "''")}'`;
  if (/^(null|true|false)$/i.test(t)) return t.toUpperCase();
  return sqlStr(t);
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
  if (/(dob|birth|dob_date|date_of_birth)/.test(c)) {
    return sqlStr(new Date(Date.UTC(1980 + (i % 30), i % 12, (i % 27) + 1)).toISOString().slice(0, 10));
  }
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
    return sqlStr(new Date(Date.now() - i * 86400000).toISOString());
  }
  if (/(uuid|guid|token)/.test(c)) return sqlStr(`id-${i + 1}-${Math.random().toString(36).slice(2, 8)}`);
  return sqlStr(`${col}_${i + 1}`);
}
