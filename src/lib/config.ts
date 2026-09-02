import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

const dataDir = resolve(process.cwd(), process.env.LOCALDB_DATA_DIR || "data");
const dbRoot = resolve(process.cwd(), process.env.LOCALDB_DB_ROOT || "databases");
const snapshotDir = resolve(dataDir, "snapshots");
const sandboxDir = resolve(dataDir, "sandboxes");
const branchDir = resolve(dataDir, "branches");

for (const dir of [dataDir, dbRoot, snapshotDir, sandboxDir, branchDir]) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

export const config = {
  dataDir,
  dbRoot,
  snapshotDir,
  sandboxDir,
  branchDir,
  appDbPath: process.env.APP_DB_PATH || resolve(dataDir, "app.db"),
  llmProvider: (process.env.LLM_PROVIDER || "heuristic").toLowerCase(),
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama3.1",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  maxPreviewRows: envInt("LOCALDB_MAX_PREVIEW_ROWS", 200),
  /** Sandbox preview: skip cloning above this size, fall back to static analysis. */
  sandboxMaxMb: envInt("LOCALDB_SANDBOX_MAX_MB", 200),
  /** Max sample changed rows surfaced from a sandbox preview. */
  sandboxSampleRows: envInt("LOCALDB_SANDBOX_SAMPLE_ROWS", 10),
  /** When true, every mutating operation needs explicit confirmation (not just risky ones). */
  requireConfirmAll: envBool("LOCALDB_REQUIRE_CONFIRM_ALL", false),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
} as const;

export type AppConfig = typeof config;
