import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

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

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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

const authModeRaw = (process.env.AUTH_MODE || "single").toLowerCase();
const authMode: "single" | "header" | "oauth" =
  authModeRaw === "header" || authModeRaw === "oauth" ? authModeRaw : "single";

const MB = 1024 * 1024;

/** Filesystem-safe, stable id derived from an email / raw identity string. */
export function slug(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = createHash("sha256").update(raw.trim().toLowerCase()).digest("hex").slice(0, 8);
  return base ? `${base}-${hash}` : hash;
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

  // ---- auth ---------------------------------------------------------
  authMode,
  /** Headers checked (in order) for the user's identity in `header` mode. */
  authHeaders: envList("AUTH_HEADER", [
    "x-auth-request-email",
    "cf-access-authenticated-user-email",
    "x-forwarded-email",
    "x-auth-request-user",
  ]),
  authSecret: process.env.AUTH_SECRET || "",
  githubId: process.env.AUTH_GITHUB_ID || "",
  githubSecret: process.env.AUTH_GITHUB_SECRET || "",
  googleId: process.env.AUTH_GOOGLE_ID || "",
  googleSecret: process.env.AUTH_GOOGLE_SECRET || "",

  // ---- per-user quotas (only meaningful in header/oauth mode) -------
  maxDbsPerUser: envInt("LOCALDB_MAX_DBS_PER_USER", authMode === "single" ? 100000 : 10),
  maxDbBytes: envInt("LOCALDB_MAX_DB_MB", authMode === "single" ? 100000 : 50) * MB,
  maxUserBytes: envInt("LOCALDB_MAX_USER_MB", authMode === "single" ? 1000000 : 200) * MB,
  agentRate: envInt("LOCALDB_AGENT_RATE", authMode === "single" ? 100000 : 30),
  agentRateWindowMs: envInt("LOCALDB_AGENT_RATE_WINDOW_S", 300) * 1000,
} as const;

export type AppConfig = typeof config;

const LOCAL_USER = "local";

/** Private database directory for a user. In `single` mode `local` uses the root. */
export function userRoot(userId: string): string {
  if (config.authMode === "single" && userId === LOCAL_USER) return config.dbRoot;
  const dir = join(config.dbRoot, "u", userId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}
