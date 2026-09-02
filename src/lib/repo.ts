import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { statSync } from "node:fs";
import { getAppDb, schema } from "@/lib/db/app-db";
import type { AgentPlan, ExecutionResult, PreviewResult, SchemaSnapshot } from "@/lib/types";

const db = () => getAppDb();

export const repo = {
  // ---- databases -------------------------------------------------------
  listDatabases(ownerId?: string) {
    const q = db().select().from(schema.databases);
    const rows = ownerId
      ? q.where(eq(schema.databases.ownerId, ownerId)).all()
      : q.all();
    return rows.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  },
  getDatabase(id: string) {
    return db().select().from(schema.databases).where(eq(schema.databases.id, id)).get();
  },
  /** Same as getDatabase but returns undefined if the caller does not own it. */
  getOwnedDatabase(id: string, ownerId: string) {
    const row = this.getDatabase(id);
    return row && row.ownerId === ownerId ? row : undefined;
  },
  getDatabaseByPath(path: string) {
    return db().select().from(schema.databases).where(eq(schema.databases.path, path)).get();
  },
  registerDatabase(ownerId: string, path: string, label: string) {
    const existing = this.getDatabaseByPath(path);
    if (existing) {
      db()
        .update(schema.databases)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(schema.databases.id, existing.id))
        .run();
      return existing;
    }
    const id = `db_${nanoid(10)}`;
    db().insert(schema.databases).values({ id, ownerId, path, label }).run();
    return this.getDatabase(id)!;
  },
  /** Total bytes a user's databases + branch files + snapshots occupy. */
  userDiskUsage(ownerId: string): number {
    const dbs = this.listDatabases(ownerId);
    let total = 0;
    for (const d of dbs) {
      try {
        total += statSync(d.path).size;
      } catch {
        /* file may not exist yet */
      }
      for (const b of this.listBranches(d.id)) {
        if (!b.isMain) total += b.sizeBytes;
      }
      for (const s of this.listSnapshots(d.id)) total += s.sizeBytes;
    }
    return total;
  },
  touchDatabase(id: string) {
    db()
      .update(schema.databases)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(schema.databases.id, id))
      .run();
  },
  setActiveBranch(databaseId: string, branchId: string) {
    db()
      .update(schema.databases)
      .set({ activeBranchId: branchId })
      .where(eq(schema.databases.id, databaseId))
      .run();
  },

  // ---- branches ------------------------------------------------------
  listBranches(databaseId: string) {
    return db()
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.databaseId, databaseId))
      .orderBy(schema.branches.createdAt)
      .all();
  },
  getBranch(id: string) {
    return db().select().from(schema.branches).where(eq(schema.branches.id, id)).get();
  },
  getOwnedBranch(id: string, ownerId: string) {
    const b = this.getBranch(id);
    if (!b) return undefined;
    return this.getOwnedDatabase(b.databaseId, ownerId) ? b : undefined;
  },
  insertBranch(row: typeof schema.branches.$inferInsert) {
    db().insert(schema.branches).values(row).run();
    return this.getBranch(row.id)!;
  },
  updateBranch(id: string, patch: Partial<typeof schema.branches.$inferInsert>) {
    db().update(schema.branches).set(patch).where(eq(schema.branches.id, id)).run();
  },
  deleteBranch(id: string) {
    db().delete(schema.operations).where(eq(schema.operations.branchId, id)).run();
    db().delete(schema.branches).where(eq(schema.branches.id, id)).run();
  },
  /** The main branch for a database, creating its row on first access. */
  ensureMainBranch(databaseId: string) {
    const existing = db()
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.databaseId, databaseId), eq(schema.branches.isMain, true)))
      .get();
    if (existing) return existing;
    const database = this.getDatabase(databaseId)!;
    const id = `br_${nanoid(10)}`;
    const branch = this.insertBranch({
      id,
      databaseId,
      name: "main",
      parentBranchId: null,
      filePath: database.path,
      isMain: true,
      status: "active",
    });
    if (!database.activeBranchId) this.setActiveBranch(databaseId, id);
    return branch;
  },
  /** Currently checked-out branch (falls back to / creates main). */
  getActiveBranch(databaseId: string) {
    const database = this.getDatabase(databaseId);
    if (!database) return null;
    if (database.activeBranchId) {
      const b = this.getBranch(database.activeBranchId);
      if (b) return b;
    }
    return this.ensureMainBranch(databaseId);
  },

  // ---- conversations --------------------------------------------------
  listConversations(databaseId: string) {
    return db()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.databaseId, databaseId))
      .orderBy(desc(schema.conversations.createdAt))
      .all();
  },
  getConversation(id: string) {
    return db().select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
  },
  getOwnedConversation(id: string, ownerId: string) {
    const c = this.getConversation(id);
    if (!c) return undefined;
    return this.getOwnedDatabase(c.databaseId, ownerId) ? c : undefined;
  },
  createConversation(databaseId: string, title = "New conversation") {
    const id = `conv_${nanoid(10)}`;
    db().insert(schema.conversations).values({ id, databaseId, title }).run();
    return db().select().from(schema.conversations).where(eq(schema.conversations.id, id)).get()!;
  },
  renameConversation(id: string, title: string) {
    db().update(schema.conversations).set({ title }).where(eq(schema.conversations.id, id)).run();
  },
  deleteConversation(id: string) {
    db().delete(schema.conversations).where(eq(schema.conversations.id, id)).run();
  },

  // ---- messages -----------------------------------------------------
  listMessages(conversationId: string) {
    return db()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(schema.messages.createdAt)
      .all();
  },
  addMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string,
    meta?: unknown,
  ) {
    const id = `msg_${nanoid(10)}`;
    db()
      .insert(schema.messages)
      .values({ id, conversationId, role, content, meta: meta ? JSON.stringify(meta) : null })
      .run();
    return id;
  },

  // ---- operations --------------------------------------------------
  createOperation(input: {
    databaseId: string;
    conversationId?: string;
    branchId?: string | null;
    intent: string;
    plan: AgentPlan;
    schemaBefore: SchemaSnapshot;
    status: "planned" | "awaiting_confirmation";
    preview?: PreviewResult | null;
  }) {
    const id = `op_${nanoid(12)}`;
    db()
      .insert(schema.operations)
      .values({
        id,
        databaseId: input.databaseId,
        conversationId: input.conversationId,
        branchId: input.branchId ?? null,
        intent: input.intent,
        risk: input.plan.risk,
        plan: JSON.stringify(input.plan),
        previewResult: input.preview ? JSON.stringify(input.preview) : null,
        schemaBefore: JSON.stringify(input.schemaBefore),
        status: input.status,
      })
      .run();
    return id;
  },
  attachPreview(id: string, preview: PreviewResult) {
    db()
      .update(schema.operations)
      .set({ previewResult: JSON.stringify(preview) })
      .where(eq(schema.operations.id, id))
      .run();
  },
  getOperation(id: string) {
    return db().select().from(schema.operations).where(eq(schema.operations.id, id)).get();
  },
  getOwnedOperation(id: string, ownerId: string) {
    const op = this.getOperation(id);
    if (!op) return undefined;
    return this.getOwnedDatabase(op.databaseId, ownerId) ? op : undefined;
  },
  listOperations(databaseId: string, limit = 50) {
    return db()
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.databaseId, databaseId))
      .orderBy(desc(schema.operations.createdAt))
      .limit(limit)
      .all();
  },
  /** Operations that ran on a specific branch (main also owns legacy null rows). */
  listBranchOperations(databaseId: string, branchId: string, isMain: boolean, limit = 200) {
    const rows = db()
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.databaseId, databaseId))
      .orderBy(schema.operations.createdAt)
      .all();
    return rows
      .filter((o) => o.branchId === branchId || (isMain && o.branchId == null))
      .slice(-limit);
  },
  finishOperation(
    id: string,
    status: "completed" | "failed" | "rolled_back" | "cancelled",
    patch: {
      result?: ExecutionResult;
      schemaAfter?: SchemaSnapshot;
      snapshotId?: string | null;
      durationMs?: number;
    } = {},
  ) {
    db()
      .update(schema.operations)
      .set({
        status,
        result: patch.result ? JSON.stringify(patch.result) : undefined,
        schemaAfter: patch.schemaAfter ? JSON.stringify(patch.schemaAfter) : undefined,
        snapshotId: patch.snapshotId ?? undefined,
        durationMs: patch.durationMs,
        completedAt: new Date().toISOString(),
      })
      .where(eq(schema.operations.id, id))
      .run();
  },
  setOperationStatus(id: string, status: string) {
    db()
      .update(schema.operations)
      .set({ status: status as never })
      .where(eq(schema.operations.id, id))
      .run();
  },

  // ---- snapshots --------------------------------------------------
  recordSnapshot(input: {
    id: string;
    databaseId: string;
    operationId?: string;
    filePath: string;
    sizeBytes: number;
    reason?: string;
  }) {
    db()
      .insert(schema.snapshots)
      .values({
        id: input.id,
        databaseId: input.databaseId,
        operationId: input.operationId,
        filePath: input.filePath,
        sizeBytes: input.sizeBytes,
        reason: input.reason ?? "pre-mutation",
      })
      .run();
  },
  getSnapshot(id: string) {
    return db().select().from(schema.snapshots).where(eq(schema.snapshots.id, id)).get();
  },
  markSnapshotConsumed(id: string) {
    db().update(schema.snapshots).set({ consumed: true }).where(eq(schema.snapshots.id, id)).run();
  },
  listSnapshots(databaseId: string) {
    return db()
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.databaseId, databaseId))
      .orderBy(desc(schema.snapshots.createdAt))
      .all();
  },
};
