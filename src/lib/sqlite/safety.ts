import type { RiskLevel, StatementKind } from "@/lib/types";

/**
 * Split a SQL script into individual statements, respecting single/double
 * quoted strings, `[...]` identifiers, and -- / block comments.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = script.length;
  while (i < n) {
    const ch = script[i];
    const next = script[i + 1];

    if (ch === "-" && next === "-") {
      while (i < n && script[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(script[i] === "*" && script[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      buf += ch;
      i++;
      while (i < n) {
        buf += script[i];
        if (script[i] === quote) {
          if (script[i + 1] === quote) {
            buf += script[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "[") {
      buf += ch;
      i++;
      while (i < n && script[i] !== "]") {
        buf += script[i];
        i++;
      }
      if (i < n) {
        buf += "]";
        i++;
      }
      continue;
    }
    if (ch === ";") {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

const KIND_PATTERNS: [RegExp, StatementKind][] = [
  [/^\s*(with\b[\s\S]*?\bselect|select|explain)\b/i, "read"],
  [/^\s*insert\b/i, "insert"],
  [/^\s*(with\b[\s\S]*?\bupdate|update)\b/i, "update"],
  [/^\s*(with\b[\s\S]*?\bdelete|delete)\b/i, "delete"],
  [/^\s*create\b/i, "create"],
  [/^\s*alter\b/i, "alter"],
  [/^\s*drop\b/i, "drop"],
  [/^\s*(vacuum|reindex|analyze)\b/i, "alter"],
  [/^\s*pragma\b/i, "pragma"],
  [/^\s*(begin|commit|rollback|savepoint|release)\b/i, "transaction"],
  [/^\s*(truncate|replace)\b/i, "delete"],
];

export function classifyStatement(sql: string): StatementKind {
  for (const [re, kind] of KIND_PATTERNS) {
    if (re.test(sql)) return kind;
  }
  return "unknown";
}

export const DESTRUCTIVE_KINDS: StatementKind[] = ["update", "delete", "drop", "alter"];

export function isDestructive(kind: StatementKind, sql: string): boolean {
  if (kind === "drop") return true;
  if (kind === "alter" && /\bdrop\s+column\b/i.test(sql)) return true;
  if (kind === "alter") return true;
  if (kind === "delete") return true;
  if (kind === "update") return true;
  return false;
}

/** Statements we will never execute, regardless of confirmation. */
const HARD_BLOCK: RegExp[] = [
  /\battach\s+database\b/i,
  /\bdetach\s+database\b/i,
  /\bpragma\s+(writable_schema|temp_store_directory|data_store_directory)\b/i,
  /\bload_extension\s*\(/i,
  /\bvacuum\s+into\b/i,
];

export interface SafetyReport {
  ok: boolean;
  blocked: string[];
  risk: RiskLevel;
  destructiveStatements: number;
  requiresConfirmation: boolean;
  warnings: string[];
  perStatement: {
    sql: string;
    kind: StatementKind;
    destructive: boolean;
    warnings: string[];
  }[];
}

export function assessScript(statements: string[]): SafetyReport {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const perStatement: SafetyReport["perStatement"] = [];
  let destructiveCount = 0;
  const RISK_ORDER: RiskLevel[] = ["safe", "low", "moderate", "high", "critical"];
  let maxRiskIdx = 0;

  const bump = (r: RiskLevel) => {
    const idx = RISK_ORDER.indexOf(r);
    if (idx > maxRiskIdx) maxRiskIdx = idx;
  };

  for (const sql of statements) {
    const kind = classifyStatement(sql);
    const stWarn: string[] = [];

    for (const re of HARD_BLOCK) {
      if (re.test(sql)) blocked.push(sql);
    }

    const destructive = isDestructive(kind, sql);
    if (destructive) destructiveCount++;

    switch (kind) {
      case "read":
      case "pragma":
        bump("safe");
        break;
      case "insert":
      case "create":
        bump("low");
        break;
      case "update":
      case "delete": {
        const hasWhere = /\bwhere\b/i.test(sql);
        if (!hasWhere) {
          bump("high");
          stWarn.push(`${kind.toUpperCase()} without WHERE affects every row.`);
        } else {
          bump("moderate");
        }
        break;
      }
      case "alter":
        bump("high");
        if (/\bdrop\s+column\b/i.test(sql)) stWarn.push("Dropping a column permanently removes data.");
        break;
      case "drop":
        bump("critical");
        stWarn.push("DROP permanently deletes a table/index and its data.");
        break;
      default:
        bump("moderate");
        stWarn.push("Unrecognized statement type — treated as potentially unsafe.");
    }

    perStatement.push({ sql, kind, destructive, warnings: stWarn });
    warnings.push(...stWarn);
  }

  const maxRisk = RISK_ORDER[maxRiskIdx];
  return {
    ok: blocked.length === 0,
    blocked,
    risk: maxRisk,
    destructiveStatements: destructiveCount,
    requiresConfirmation: destructiveCount > 0 || maxRiskIdx >= RISK_ORDER.indexOf("high"),
    warnings,
    perStatement,
  };
}

export function extractTables(sql: string): string[] {
  const names = new Set<string>();
  const re =
    /\b(?:from|join|into|update|table(?:\s+if\s+not\s+exists)?|table\s+if\s+exists)\s+["'`\[]?([a-zA-Z_][a-zA-Z0-9_]*)["'`\]]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    names.add(m[1]);
  }
  return [...names];
}
