import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "localdb-auth-"));
  process.env.LOCALDB_DB_ROOT = tmp;
  process.env.LOCALDB_DATA_DIR = join(tmp, "data");
  process.env.AUTH_MODE = "single";
});

describe("resolveUserDbPath", () => {
  it("confines a relative path to the user's own directory", async () => {
    const { resolveUserDbPath } = await import("@/lib/sqlite/path-safety");
    const p = resolveUserDbPath("alice", "my.db");
    expect(p).toContain(join("u", "alice"));
    expect(p.endsWith("my.db")).toBe(true);
  });

  it("rejects escaping into another user's directory", async () => {
    const { resolveUserDbPath, PathSafetyError } = await import("@/lib/sqlite/path-safety");
    expect(() => resolveUserDbPath("alice", "../bob/secret.db")).toThrow(PathSafetyError);
    expect(() => resolveUserDbPath("alice", "../../etc/passwd.db")).toThrow(PathSafetyError);
  });

  it("still rejects bad extensions and URIs", async () => {
    const { resolveUserDbPath } = await import("@/lib/sqlite/path-safety");
    expect(() => resolveUserDbPath("alice", "notes.txt")).toThrow();
    expect(() => resolveUserDbPath("alice", "https://evil/x.db")).toThrow();
  });
});

describe("slug", () => {
  it("is filesystem-safe and stable", async () => {
    const { slug } = await import("@/lib/config");
    expect(slug("Alice@Example.com")).toMatch(/^[a-z0-9-]+$/);
    expect(slug("Alice@Example.com")).toBe(slug("alice@example.com"));
    expect(slug("a@x.com")).not.toBe(slug("b@x.com"));
  });
});

describe("getRequestUser — single mode", () => {
  it("always returns the local user", async () => {
    const { getRequestUser } = await import("@/lib/auth");
    const u = await getRequestUser(new Request("http://x/"));
    expect(u).toEqual({ id: "local", email: null, name: "Local" });
  });
});
