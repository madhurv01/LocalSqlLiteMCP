import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "localdb-test-"));
  process.env.LOCALDB_DB_ROOT = tmp;
  process.env.LOCALDB_DATA_DIR = join(tmp, "data");
  process.env.LLM_PROVIDER = "heuristic";
});

describe("heuristic planner + executor", () => {
  it("plans create + insert and executes it transactionally", async () => {
    const { HeuristicProvider } = await import("@/lib/agent/providers/heuristic");
    const { tool_execute, tool_query } = await import("@/lib/mcp/tools");

    const provider = new HeuristicProvider();
    const plan = await provider.plan({
      message: "Create a users table with id, name, email and insert 5 sample users",
      schema: { capturedAt: new Date().toISOString(), tables: [] },
      history: [],
    });

    expect(plan.statements.length).toBe(2);
    expect(plan.statements[0].kind).toBe("create");
    expect(plan.statements[1].kind).toBe("insert");

    const dbPath = join(tmp, "t.db");
    const res = tool_execute({
      databasePath: dbPath,
      sql: plan.statements.map((s) => s.sql).join(";\n"),
      confirmDestructive: false,
      snapshot: true,
    });
    expect(res.ok).toBe(true);

    const check = tool_query({ databasePath: dbPath, sql: "SELECT COUNT(*) c FROM users" });
    expect((check.results[0].rows as { c: number }[])[0].c).toBe(5);
  });

  it("plans RENAME TABLE and RENAME COLUMN", async () => {
    const { HeuristicProvider } = await import("@/lib/agent/providers/heuristic");
    const provider = new HeuristicProvider();
    const schema = {
      capturedAt: new Date().toISOString(),
      tables: [
        {
          name: "product",
          type: "table" as const,
          columns: [{ name: "id", type: "INTEGER", notNull: false, primaryKey: true, defaultValue: null }],
          rowCount: 0,
          indexes: [],
          foreignKeys: [],
          createSql: "",
        },
      ],
    };
    const p1 = await provider.plan({ message: "rename product table to items", schema, history: [] });
    expect(p1.statements[0].sql).toBe('ALTER TABLE "product" RENAME TO "items"');

    const p2 = await provider.plan({
      message: "rename column id in product to product_id",
      schema,
      history: [],
    });
    expect(p2.statements[0].sql).toBe('ALTER TABLE "product" RENAME COLUMN "id" TO "product_id"');
  });

  it("refuses a destructive statement without confirmation", async () => {
    const { tool_execute } = await import("@/lib/mcp/tools");
    const dbPath = join(tmp, "t2.db");
    tool_execute({ databasePath: dbPath, sql: "CREATE TABLE a (id int)", confirmDestructive: false, snapshot: false });
    expect(() =>
      tool_execute({ databasePath: dbPath, sql: "DROP TABLE a", confirmDestructive: false, snapshot: true }),
    ).toThrow(/confirmDestructive/);
  });

  it("rolls the whole batch back on error", async () => {
    const { tool_execute, tool_query } = await import("@/lib/mcp/tools");
    const dbPath = join(tmp, "t3.db");
    tool_execute({ databasePath: dbPath, sql: "CREATE TABLE b (id int)", confirmDestructive: false, snapshot: false });
    const res = tool_execute({
      databasePath: dbPath,
      sql: "INSERT INTO b VALUES (1); INSERT INTO nonexistent VALUES (2)",
      confirmDestructive: false,
      snapshot: false,
    });
    expect(res.ok).toBe(false);
    const check = tool_query({ databasePath: dbPath, sql: "SELECT COUNT(*) c FROM b" });
    expect((check.results[0].rows as { c: number }[])[0].c).toBe(0);
  });
});
