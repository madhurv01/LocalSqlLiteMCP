import { describe, expect, it } from "vitest";
import { HeuristicProvider } from "@/lib/agent/providers/heuristic";
import type { SchemaSnapshot } from "@/lib/types";

const provider = new HeuristicProvider();

function schemaWith(...names: string[]): SchemaSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    tables: names.map((name) => ({
      name,
      type: "table" as const,
      columns: [
        { name: "id", type: "INTEGER", notNull: false, primaryKey: true, defaultValue: null },
        { name: "name", type: "TEXT", notNull: true, primaryKey: false, defaultValue: null },
        { name: "city", type: "TEXT", notNull: false, primaryKey: false, defaultValue: null },
        { name: "status", type: "TEXT", notNull: false, primaryKey: false, defaultValue: null },
      ],
      rowCount: 12,
      indexes: [],
      foreignKeys: [],
      createSql: "",
    })),
  };
}

const plan = (message: string, schema: SchemaSnapshot = schemaWith("customers", "orders")) =>
  provider.plan({ message, schema, history: [] });

describe("heuristic planner — read intents", () => {
  it("lists tables", async () => {
    for (const q of [
      "list all tables",
      "Can you please list me all the table names in my sqlite db",
      "what tables are in the database",
      "show me every table",
    ]) {
      const p = await plan(q);
      expect(p.statements[0]?.kind, q).toBe("read");
      expect(p.statements[0].sql).toMatch(/sqlite_master/i);
    }
  });

  it("counts tables", async () => {
    const p = await plan("how many tables are there");
    expect(p.statements[0].sql).toMatch(/COUNT\(\*\).*sqlite_master/i);
  });

  it("describes a table", async () => {
    const p = await plan("describe customers");
    expect(p.statements[0].kind).toBe("read");
    expect(p.statements[0].sql).toMatch(/pragma_table_info\('customers'\)/);
  });

  it("counts rows in a table (singular/plural)", async () => {
    for (const q of ["how many rows in orders", "count the records in orders", "how many customers do we have"]) {
      const p = await plan(q);
      expect(p.statements[0].sql, q).toMatch(/SELECT COUNT\(\*\) AS count FROM "(orders|customers)"/);
    }
  });

  it("selects rows with a guessed filter", async () => {
    const p = await plan("show all customers in Berlin");
    expect(p.statements[0].sql).toBe('SELECT * FROM "customers" WHERE "city" = \'Berlin\' LIMIT 100');
  });

  it("selects rows with an explicit where", async () => {
    const p = await plan("list orders where status = 'shipped'");
    expect(p.statements[0].sql).toMatch(/SELECT \* FROM "orders" WHERE status = 'shipped'/);
  });
});

describe("heuristic planner — write intents", () => {
  it("creates a table from loose phrasing and seeds it", async () => {
    const p = await plan(
      "create me a table named test_env, with two fields name, dob, fill 10 rows of dummy data to it",
      schemaWith("customers"),
    );
    expect(p.statements).toHaveLength(2);
    expect(p.statements[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS "test_env"/);
    expect(p.statements[0].sql).toMatch(/"name"/);
    expect(p.statements[0].sql).toMatch(/"dob"/);
    expect(p.statements[1].kind).toBe("insert");
    expect(p.statements[1].sql.match(/\(/g)!.length).toBeGreaterThanOrEqual(10);
  });

  it("renames a table (multiple phrasings)", async () => {
    for (const q of ["rename product table to madhur_test", "rename table product to madhur_test"]) {
      const p = await plan(q, schemaWith("product"));
      expect(p.statements[0].sql, q).toBe('ALTER TABLE "product" RENAME TO "madhur_test"');
    }
  });

  it("adds and drops columns", async () => {
    const add = await plan("add a column age to customers");
    expect(add.statements[0].sql).toBe('ALTER TABLE "customers" ADD COLUMN "age" INTEGER');
    const drop = await plan("drop column city from customers");
    expect(drop.statements[0].sql).toBe('ALTER TABLE "customers" DROP COLUMN "city"');
  });

  it("updates rows from natural language", async () => {
    const p = await plan("set status to shipped in orders where id = 3");
    expect(p.statements[0].sql).toBe('UPDATE "orders" SET "status" = \'shipped\' WHERE id = 3');
    expect(p.statements[0].kind).toBe("update");
  });

  it("passes real SQL through untouched", async () => {
    const p = await plan("SELECT id, name FROM customers WHERE city = 'Berlin'");
    expect(p.statements[0].sql).toBe("SELECT id, name FROM customers WHERE city = 'Berlin'");
    expect(p.statements[0].kind).toBe("read");
  });

  it("does NOT treat a natural-language 'create' sentence as raw SQL", async () => {
    const p = await plan("create a widgets table with title and price", schemaWith("customers"));
    expect(p.statements[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS "widgets"/);
    expect(p.statements[0].sql).not.toMatch(/create a widgets table with/i);
  });
});
