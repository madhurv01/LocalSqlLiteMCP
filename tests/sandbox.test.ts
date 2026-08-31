import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "localdb-sbx-"));
  process.env.LOCALDB_DB_ROOT = tmp;
  process.env.LOCALDB_DATA_DIR = join(tmp, "data");
});

describe("runInSandbox", () => {
  it("reports real row deltas and sample changes without touching the file", async () => {
    const { tool_execute, tool_query } = await import("@/lib/mcp/tools");
    const { runInSandbox } = await import("@/lib/sqlite/sandbox");
    const db = join(tmp, "s.db");

    tool_execute({
      databasePath: db,
      sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t (name) VALUES ('a'),('b'),('c')",
      confirmDestructive: false,
      snapshot: false,
    });

    const preview = runInSandbox(db, "INSERT INTO t (name) VALUES ('d'),('e')", { sampleRows: 5 });
    expect(preview.mode).toBe("sandbox");
    expect(preview.ok).toBe(true);
    expect(preview.rowDeltas).toEqual([{ table: "t", before: 3, after: 5 }]);
    expect(preview.sampleChanges.filter((c) => c.op === "insert")).toHaveLength(2);

    // real database still has only 3 rows
    const check = tool_query({ databasePath: db, sql: "SELECT COUNT(*) c FROM t" });
    expect((check.results[0].rows as { c: number }[])[0].c).toBe(3);
  });

  it("captures a failure that would occur on apply", async () => {
    const { tool_execute } = await import("@/lib/mcp/tools");
    const { runInSandbox } = await import("@/lib/sqlite/sandbox");
    const db = join(tmp, "s2.db");
    tool_execute({ databasePath: db, sql: "CREATE TABLE t (id INT)", confirmDestructive: false, snapshot: false });

    const preview = runInSandbox(db, "INSERT INTO missing VALUES (1)");
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/missing/);
  });

  it("detects UPDATE changes with before/after rows", async () => {
    const { tool_execute } = await import("@/lib/mcp/tools");
    const { runInSandbox } = await import("@/lib/sqlite/sandbox");
    const db = join(tmp, "s3.db");
    tool_execute({
      databasePath: db,
      sql: "CREATE TABLE u (id INTEGER PRIMARY KEY, status TEXT); INSERT INTO u (status) VALUES ('pending'),('pending')",
      confirmDestructive: false,
      snapshot: false,
    });
    const preview = runInSandbox(db, "UPDATE u SET status='done' WHERE id=1");
    const upd = preview.sampleChanges.find((c) => c.op === "update");
    expect(upd?.before?.status).toBe("pending");
    expect(upd?.after?.status).toBe("done");
  });

  it("flags non-deterministic SQL", async () => {
    const { tool_execute } = await import("@/lib/mcp/tools");
    const { runInSandbox } = await import("@/lib/sqlite/sandbox");
    const db = join(tmp, "s4.db");
    tool_execute({ databasePath: db, sql: "CREATE TABLE k (id INT, ts TEXT)", confirmDestructive: false, snapshot: false });
    const preview = runInSandbox(db, "INSERT INTO k VALUES (1, CURRENT_TIMESTAMP)");
    expect(preview.nonDeterministic).toBe(true);
  });
});
