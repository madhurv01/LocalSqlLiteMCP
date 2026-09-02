import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This whole file runs in `header` auth mode so per-user scoping is active.
beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "localdb-mu-"));
  process.env.LOCALDB_DB_ROOT = tmp;
  process.env.LOCALDB_DATA_DIR = join(tmp, "data");
  process.env.AUTH_MODE = "header";
  process.env.LOCALDB_MAX_DBS_PER_USER = "3";
  process.env.LOCALDB_AGENT_RATE = "2";
});

describe("header-mode identity", () => {
  it("parses the email from the first present header", async () => {
    const { getRequestUser } = await import("@/lib/auth");
    const u = await getRequestUser(
      new Request("http://x/", { headers: { "cf-access-authenticated-user-email": "Ann@X.com" } }),
    );
    expect(u?.email).toBe("ann@x.com");
    expect(u?.id).toMatch(/^ann-x-com-[0-9a-f]{8}$/);
  });
  it("returns null when no identity header is present", async () => {
    const { getRequestUser } = await import("@/lib/auth");
    expect(await getRequestUser(new Request("http://x/"))).toBeNull();
  });
});

describe("workspace isolation", () => {
  it("keeps each user's databases private and rejects cross-user access", async () => {
    const { repo } = await import("@/lib/repo");
    const { tool_execute } = await import("@/lib/mcp/tools");
    const { resolveUserDbPath } = await import("@/lib/sqlite/path-safety");

    const aPath = resolveUserDbPath("alice", "app.db");
    tool_execute({ databasePath: aPath, sql: "CREATE TABLE t (id int)", confirmDestructive: false, snapshot: false });
    const aDb = repo.registerDatabase("alice", aPath, "alice-app");
    repo.ensureMainBranch(aDb.id);
    const aBranch = repo.getActiveBranch(aDb.id)!;

    // bob sees nothing of alice's
    expect(repo.listDatabases("bob")).toHaveLength(0);
    expect(repo.getOwnedDatabase(aDb.id, "bob")).toBeUndefined();
    expect(repo.getOwnedBranch(aBranch.id, "bob")).toBeUndefined();
    expect(repo.getOwnedDatabase(aDb.id, "alice")?.id).toBe(aDb.id);

    // bob's path resolves to bob's dir, not alice's
    const bPath = resolveUserDbPath("bob", "app.db");
    expect(bPath).not.toBe(aPath);
  });
});

describe("quotas", () => {
  it("rejects the Nth+1 database and oversized uploads", async () => {
    const { repo } = await import("@/lib/repo");
    const { assertQuota, LimitError } = await import("@/lib/quota");
    const { resolveUserDbPath } = await import("@/lib/sqlite/path-safety");
    const { tool_execute } = await import("@/lib/mcp/tools");

    for (let i = 0; i < 3; i++) {
      const p = resolveUserDbPath("carol", `db${i}.db`);
      tool_execute({ databasePath: p, sql: "CREATE TABLE t (id int)", confirmDestructive: false, snapshot: false });
      repo.registerDatabase("carol", p, `db${i}`);
    }
    expect(() => assertQuota("carol", { newDb: true })).toThrow(LimitError);
    expect(() => assertQuota("carol", { newBytes: 999 * 1024 * 1024 })).toThrow(LimitError);
  });
});

describe("rate limit", () => {
  it("trips after the configured number of agent requests", async () => {
    const { assertRate, LimitError } = await import("@/lib/quota");
    assertRate("dave");
    assertRate("dave");
    expect(() => assertRate("dave")).toThrow(LimitError);
  });
});
