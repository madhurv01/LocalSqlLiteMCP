import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";

beforeAll(() => {
  process.env.LOCALDB_DB_ROOT = resolve(process.cwd(), "databases");
});

describe("resolveDbPath", () => {
  it("accepts a simple relative .db path", async () => {
    const { resolveDbPath } = await import("@/lib/sqlite/path-safety");
    expect(resolveDbPath("demo.db")).toContain("databases");
  });
  it("rejects path traversal", async () => {
    const { resolveDbPath, PathSafetyError } = await import("@/lib/sqlite/path-safety");
    expect(() => resolveDbPath("../../etc/passwd.db")).toThrow(PathSafetyError);
  });
  it("rejects non-sqlite extensions", async () => {
    const { resolveDbPath } = await import("@/lib/sqlite/path-safety");
    expect(() => resolveDbPath("notes.txt")).toThrow();
  });
  it("rejects remote URIs", async () => {
    const { resolveDbPath } = await import("@/lib/sqlite/path-safety");
    expect(() => resolveDbPath("https://evil.com/x.db")).toThrow();
  });
});
