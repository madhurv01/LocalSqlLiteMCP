import { describe, expect, it } from "vitest";
import {
  assessScript,
  classifyStatement,
  splitStatements,
  extractTables,
} from "@/lib/sqlite/safety";

describe("splitStatements", () => {
  it("splits on semicolons outside strings", () => {
    expect(splitStatements("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });
  it("ignores semicolons in string literals", () => {
    const s = splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1");
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("'a;b'");
  });
  it("strips line and block comments", () => {
    const s = splitStatements("-- a comment\nSELECT 1; /* block ; */ SELECT 2");
    expect(s).toEqual(["SELECT 1", "SELECT 2"]);
  });
});

describe("classifyStatement", () => {
  it.each([
    ["SELECT * FROM t", "read"],
    ["WITH x AS (SELECT 1) SELECT * FROM x", "read"],
    ["INSERT INTO t VALUES (1)", "insert"],
    ["UPDATE t SET a=1", "update"],
    ["DELETE FROM t", "delete"],
    ["CREATE TABLE t (id int)", "create"],
    ["ALTER TABLE t ADD COLUMN c int", "alter"],
    ["DROP TABLE t", "drop"],
    ["PRAGMA table_info(t)", "pragma"],
  ])("%s -> %s", (sql, kind) => {
    expect(classifyStatement(sql)).toBe(kind);
  });
});

describe("assessScript", () => {
  it("flags DELETE without WHERE as high risk needing confirmation", () => {
    const r = assessScript(["DELETE FROM users"]);
    expect(r.risk).toBe("high");
    expect(r.requiresConfirmation).toBe(true);
  });
  it("treats a WHERE-scoped update as moderate", () => {
    const r = assessScript(["UPDATE users SET name='x' WHERE id=1"]);
    expect(r.risk).toBe("moderate");
  });
  it("marks DROP as critical", () => {
    const r = assessScript(["DROP TABLE users"]);
    expect(r.risk).toBe("critical");
    expect(r.destructiveStatements).toBe(1);
  });
  it("blocks ATTACH DATABASE outright", () => {
    const r = assessScript(["ATTACH DATABASE 'x.db' AS y"]);
    expect(r.ok).toBe(false);
    expect(r.blocked).toHaveLength(1);
  });
  it("keeps pure reads safe", () => {
    const r = assessScript(["SELECT * FROM users", "PRAGMA table_info(users)"]);
    expect(r.risk).toBe("safe");
    expect(r.requiresConfirmation).toBe(false);
  });
});

describe("extractTables", () => {
  it("pulls table names from common clauses", () => {
    expect(extractTables("SELECT * FROM orders JOIN customers ON x").sort()).toEqual([
      "customers",
      "orders",
    ]);
  });
});
