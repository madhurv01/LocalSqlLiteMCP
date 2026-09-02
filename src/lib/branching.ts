import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { repo } from "@/lib/repo";
import { cloneDatabaseToFile } from "@/lib/sqlite/clone";
import { openUserDb, closeUserDb } from "@/lib/sqlite/connection-manager";
import { captureSchema } from "@/lib/sqlite/introspect";
import { diffSchemas } from "@/lib/sqlite/diff";
import { runInSandbox } from "@/lib/sqlite/sandbox";
import type {
  AgentPlan,
  BranchComparison,
  BranchView,
  PreviewResult,
  SchemaSnapshot,
} from "@/lib/types";
import { LocalMcpClient } from "@/lib/mcp/client";
import type { BranchRow } from "@/lib/db/schema";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _/-]{0,60}$/;

export class BranchError extends Error {}

function branchFile(databaseId: string, branchId: string): string {
  return join(config.branchDir, `${databaseId}__${branchId}.db`);
}

function summarise(schema: SchemaSnapshot) {
  return {
    tableCount: schema.tables.length,
    rowCount: schema.tables.reduce((s, t) => s + t.rowCount, 0),
  };
}

/** Every branch of a database, decorated for the UI. */
export function listBranchViews(databaseId: string): BranchView[] {
  repo.ensureMainBranch(databaseId);
  const active = repo.getActiveBranch(databaseId);
  const branches = repo.listBranches(databaseId);
  return branches.map((b) => {
    const exists = existsSync(b.filePath);
    let tableCount = 0;
    let rowCount = 0;
    if (exists) {
      try {
        ({ tableCount, rowCount } = summarise(captureSchema(openUserDb(b.filePath, { readonly: true }))));
      } catch {
        /* ignore */
      }
    }
    const ops = repo.listBranchOperations(databaseId, b.id, b.isMain);
    const forkIdx = b.forkedFromOperationId
      ? ops.findIndex((o) => o.id === b.forkedFromOperationId)
      : -1;
    return {
      id: b.id,
      name: b.name,
      isMain: b.isMain,
      isActive: active?.id === b.id,
      parentBranchId: b.parentBranchId,
      status: b.status,
      createdAt: b.createdAt,
      operationCount: ops.length,
      tableCount,
      rowCount,
      aheadBy: b.isMain ? 0 : ops.filter((o) => o.status === "completed").length - Math.max(0, forkIdx + 1),
      exists,
    };
  });
}

export function createBranch(
  databaseId: string,
  name: string,
  fromBranchId?: string,
): BranchRow {
  if (!NAME_RE.test(name.trim())) {
    throw new BranchError("Branch name: letters, numbers, spaces, _ / - (max 60 chars).");
  }
  const clean = name.trim();
  repo.ensureMainBranch(databaseId);
  const source = fromBranchId ? repo.getBranch(fromBranchId) : repo.getActiveBranch(databaseId);
  if (!source) throw new BranchError("Source branch not found.");
  if (repo.listBranches(databaseId).some((b) => b.name.toLowerCase() === clean.toLowerCase())) {
    throw new BranchError(`A branch named "${clean}" already exists.`);
  }

  const id = `br_${nanoid(10)}`;
  const filePath = branchFile(databaseId, id);
  cloneDatabaseToFile(source.filePath, filePath);
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    /* ignore */
  }

  const baseSchema = captureSchema(openUserDb(source.filePath, { readonly: true }));
  const sourceOps = repo.listBranchOperations(databaseId, source.id, source.isMain);
  const branch = repo.insertBranch({
    id,
    databaseId,
    name: clean,
    parentBranchId: source.id,
    filePath,
    sizeBytes,
    isMain: false,
    baseSchema: JSON.stringify(baseSchema),
    forkedFromOperationId: sourceOps.at(-1)?.id ?? null,
    status: "active",
  });
  logger.info("branch created", { databaseId, id, name: clean, from: source.name });
  return branch;
}

export function activateBranch(databaseId: string, branchId: string): BranchRow {
  const branch = repo.getBranch(branchId);
  if (!branch || branch.databaseId !== databaseId) throw new BranchError("Branch not found.");
  if (!existsSync(branch.filePath)) throw new BranchError("This branch's database file is missing.");
  repo.setActiveBranch(databaseId, branchId);
  logger.info("branch activated", { databaseId, branchId, name: branch.name });
  return branch;
}

export function discardBranch(databaseId: string, branchId: string): { switchedTo: string | null } {
  const branch = repo.getBranch(branchId);
  if (!branch || branch.databaseId !== databaseId) throw new BranchError("Branch not found.");
  if (branch.isMain) throw new BranchError("The main branch cannot be discarded.");

  const active = repo.getActiveBranch(databaseId);
  let switchedTo: string | null = null;
  if (active?.id === branchId) {
    const main = repo.ensureMainBranch(databaseId);
    repo.setActiveBranch(databaseId, main.id);
    switchedTo = main.id;
  }
  try {
    closeUserDb(branch.filePath);
  } catch {
    /* ignore */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      if (existsSync(branch.filePath + suffix)) rmSync(branch.filePath + suffix);
    } catch {
      /* ignore */
    }
  }
  repo.deleteBranch(branchId);
  logger.info("branch discarded", { databaseId, branchId });
  return { switchedTo };
}

export function compareBranch(databaseId: string, branchId: string): BranchComparison {
  const branch = repo.getBranch(branchId);
  if (!branch || branch.databaseId !== databaseId) throw new BranchError("Branch not found.");
  const parent = branch.parentBranchId ? repo.getBranch(branch.parentBranchId) : null;
  const parentSchema: SchemaSnapshot = parent && existsSync(parent.filePath)
    ? captureSchema(openUserDb(parent.filePath, { readonly: true }))
    : { capturedAt: new Date().toISOString(), tables: [] };
  const branchSchema = captureSchema(openUserDb(branch.filePath, { readonly: true }));

  const parentCounts = new Map(parentSchema.tables.map((t) => [t.name, t.rowCount]));
  const branchCounts = new Map(branchSchema.tables.map((t) => [t.name, t.rowCount]));
  const rowDeltas: BranchComparison["rowDeltas"] = [];
  for (const name of new Set([...parentCounts.keys(), ...branchCounts.keys()])) {
    const p = parentCounts.get(name) ?? 0;
    const b = branchCounts.get(name) ?? 0;
    if (p !== b) rowDeltas.push({ table: name, parent: p, branch: b });
  }

  const ops = repo
    .listBranchOperations(databaseId, branch.id, branch.isMain)
    .filter((o) => o.id !== branch.forkedFromOperationId)
    .map((o) => ({ id: o.id, intent: o.intent, risk: o.risk, status: o.status, createdAt: o.createdAt }));

  return {
    branch: branch.name,
    parent: parent?.name ?? "(none)",
    schemaDiff: diffSchemas(parentSchema, branchSchema),
    rowDeltas,
    operations: ops,
  };
}

function structuralSignature(schema: SchemaSnapshot): string {
  return schema.tables
    .map((t) => `${t.name}(${t.columns.map((c) => c.name).sort().join(",")})`)
    .sort()
    .join("|");
}

export interface MergeResult {
  ok: boolean;
  conflict?: string;
  applied: number;
  preview?: PreviewResult;
  message: string;
}

/**
 * Replay a branch's operations onto its parent. With `confirm=false` this only
 * previews the combined effect on a sandbox copy of the parent.
 */
export function mergeBranch(
  databaseId: string,
  branchId: string,
  confirm: boolean,
): MergeResult {
  const branch = repo.getBranch(branchId);
  if (!branch || branch.databaseId !== databaseId) throw new BranchError("Branch not found.");
  if (branch.isMain) throw new BranchError("Cannot merge the main branch into itself.");
  const parent = branch.parentBranchId ? repo.getBranch(branch.parentBranchId) : null;
  if (!parent) throw new BranchError("This branch has no parent to merge into.");

  // Conflict check: has the parent's structure changed since the fork?
  const forkSchema: SchemaSnapshot | null = branch.baseSchema ? JSON.parse(branch.baseSchema) : null;
  const parentNow = captureSchema(openUserDb(parent.filePath, { readonly: true }));
  if (forkSchema && structuralSignature(forkSchema) !== structuralSignature(parentNow)) {
    return {
      ok: false,
      applied: 0,
      conflict: `"${parent.name}" changed structurally since "${branch.name}" was created. Re-create the branch from the current ${parent.name} and re-apply your changes.`,
      message: "Merge blocked by a structural conflict.",
    };
  }

  const ops = repo
    .listBranchOperations(databaseId, branch.id, branch.isMain)
    .filter((o) => o.status === "completed" && o.id !== branch.forkedFromOperationId);
  const sql = ops
    .flatMap((o) => {
      try {
        return (JSON.parse(o.plan) as AgentPlan).statements.map((s) => s.sql);
      } catch {
        return [];
      }
    })
    .filter(Boolean);

  if (!sql.length) {
    return { ok: true, applied: 0, message: `"${branch.name}" has no committed changes to merge.` };
  }

  const combined = sql.join(";\n");
  if (!confirm) {
    const preview = runInSandbox(parent.filePath, combined, { sampleRows: config.sandboxSampleRows });
    return {
      ok: preview.ok,
      applied: sql.length,
      preview,
      message: preview.ok
        ? `Previewing ${sql.length} statement(s) from "${branch.name}" onto "${parent.name}".`
        : `Merge would fail: ${preview.error}`,
    };
  }

  const mcp = new LocalMcpClient();
  const before = parentNow;
  const raw = mcp.invoke<{
    ok: boolean;
    error?: string;
    durationMs: number;
    statements: unknown[];
    snapshotId: string | null;
    snapshotFilePath?: string | null;
    schemaAfter?: SchemaSnapshot;
  }>("execute", {
    databasePath: parent.filePath,
    sql: combined,
    confirmDestructive: true,
    snapshot: true,
    databaseId,
  });

  if (!raw.ok) {
    return { ok: false, applied: 0, message: `Merge failed and was rolled back: ${raw.error}` };
  }

  if (raw.snapshotId && raw.snapshotFilePath) {
    repo.recordSnapshot({
      id: raw.snapshotId,
      databaseId,
      operationId: undefined,
      filePath: raw.snapshotFilePath,
      sizeBytes: 0,
      reason: `merge:${branch.name}`,
    });
  }

  const after = raw.schemaAfter ?? captureSchema(openUserDb(parent.filePath, {}));
  const mergeOpId = repo.createOperation({
    databaseId,
    branchId: parent.id,
    intent: `Merge branch "${branch.name}" into "${parent.name}"`,
    plan: {
      summary: `Merged ${sql.length} statement(s) from "${branch.name}".`,
      intent: "merge-branch",
      statements: sql.map((s) => ({
        sql: s,
        kind: "unknown" as const,
        rationale: `From branch "${branch.name}".`,
        tables: [],
        destructive: false,
      })),
      verifications: [],
      requiresConfirmation: false,
      risk: "moderate",
      notes: [],
    },
    schemaBefore: before,
    status: "planned",
  });
  repo.finishOperation(mergeOpId, "completed", {
    schemaAfter: after,
    snapshotId: raw.snapshotId,
    durationMs: raw.durationMs,
  });

  repo.updateBranch(branchId, {
    status: "merged",
    mergedIntoBranchId: parent.id,
    mergedAt: new Date().toISOString(),
  });
  // Land the user back on the branch they merged into.
  if (repo.getActiveBranch(databaseId)?.id === branchId) {
    repo.setActiveBranch(databaseId, parent.id);
  }
  logger.info("branch merged", { databaseId, branchId, into: parent.id, statements: sql.length });

  return {
    ok: true,
    applied: sql.length,
    message: `Merged ${sql.length} statement(s) from "${branch.name}" into "${parent.name}". A snapshot was taken - the merge is undoable from Operations.`,
  };
}
