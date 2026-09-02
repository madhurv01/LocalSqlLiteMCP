import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "localdb-branch-"));
  process.env.LOCALDB_DB_ROOT = tmp;
  process.env.LOCALDB_DATA_DIR = join(tmp, "data");
  process.env.LLM_PROVIDER = "heuristic";
});

describe("database branching", () => {
  it("forks, isolates writes, diffs, and merges back", async () => {
    const { tool_execute, tool_query } = await import("@/lib/mcp/tools");
    const { repo } = await import("@/lib/repo");
    const { createBranch, activateBranch, compareBranch, mergeBranch } = await import("@/lib/branching");
    const { executeOperation } = await import("@/lib/agent/orchestrator");

    const dbPath = join(tmp, "app.db");
    tool_execute({
      databasePath: dbPath,
      sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('a'),('b')",
      confirmDestructive: false,
      snapshot: false,
    });
    const database = repo.registerDatabase("local", dbPath, "app");
    const main = repo.ensureMainBranch(database.id);

    // fork
    const exp = createBranch(database.id, "experiment");
    expect(exp.filePath).not.toBe(main.filePath);
    activateBranch(database.id, exp.id);

    // run a mutating op ON the branch via the pipeline's executeOperation
    const opId = repo.createOperation({
      databaseId: database.id,
      branchId: exp.id,
      intent: "seed",
      plan: {
        summary: "insert",
        intent: "insert",
        statements: [
          { sql: "INSERT INTO items (name) VALUES ('c'),('d'),('e')", kind: "insert", rationale: "", tables: ["items"], destructive: false },
        ],
        verifications: [],
        requiresConfirmation: false,
        risk: "low",
        notes: [],
      },
      schemaBefore: { capturedAt: new Date().toISOString(), tables: [] },
      status: "planned",
    });
    for await (const _ of executeOperation(opId)) void _;

    // branch has 5 rows, main still has 2
    expect((tool_query({ databasePath: exp.filePath, sql: "SELECT COUNT(*) c FROM items" }).results[0].rows as { c: number }[])[0].c).toBe(5);
    expect((tool_query({ databasePath: main.filePath, sql: "SELECT COUNT(*) c FROM items" }).results[0].rows as { c: number }[])[0].c).toBe(2);

    // diff shows +3 rows
    const cmp = compareBranch(database.id, exp.id);
    expect(cmp.rowDeltas).toEqual([{ table: "items", parent: 2, branch: 5 }]);

    // preview merge, then merge
    const preview = mergeBranch(database.id, exp.id, false);
    expect(preview.ok).toBe(true);
    expect(preview.preview?.mode).toBe("sandbox");

    const merged = mergeBranch(database.id, exp.id, true);
    expect(merged.ok).toBe(true);
    expect((tool_query({ databasePath: main.filePath, sql: "SELECT COUNT(*) c FROM items" }).results[0].rows as { c: number }[])[0].c).toBe(5);
    expect(repo.getBranch(exp.id)?.status).toBe("merged");
  });

  it("blocks a merge when the parent changed structurally since the fork", async () => {
    const { tool_execute } = await import("@/lib/mcp/tools");
    const { repo } = await import("@/lib/repo");
    const { createBranch, mergeBranch } = await import("@/lib/branching");

    const dbPath = join(tmp, "conflict.db");
    tool_execute({ databasePath: dbPath, sql: "CREATE TABLE t (id INT)", confirmDestructive: false, snapshot: false });
    const database = repo.registerDatabase("local", dbPath, "conflict");
    repo.ensureMainBranch(database.id);
    const br = createBranch(database.id, "feature");

    // change main structurally after the fork
    tool_execute({ databasePath: dbPath, sql: "ALTER TABLE t ADD COLUMN extra TEXT", confirmDestructive: true, snapshot: false });

    const res = mergeBranch(database.id, br.id, true);
    expect(res.ok).toBe(false);
    expect(res.conflict).toMatch(/structurally/i);
  });
});
