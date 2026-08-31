import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAppDb, schema } from "@/lib/db/app-db";
import type { AgentPlan, ExecutionResult, PreviewResult, SchemaSnapshot } from "@/lib/types";

const db = () => getAppDb();

export const repo = {
  // ---- databases -------------------------------------------------------
  listDatabases() {
    return db().select().from(schema.databases).orderBy(desc(schema.databases.lastUsedAt)).all();
  },
  getDatabase(id: string) {
    return db().select().from(schema.databases).where(eq(schema.databases.id, id)).get();
  },
  getDatabaseByPath(path: string) {
    return db().select().from(schema.databases).where(eq(schema.databases.path, path)).get();
  },
  registerDatabase(path: string, label: string) {
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
    db().insert(schema.databases).values({ id, path, label }).run();
    return this.getDatabase(id)!;
  },
  touchDatabase(id: string) {
    db()
      .update(schema.databases)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(schema.databases.id, id))
      .run();
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
  listOperations(databaseId: string, limit = 50) {
    return db()
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.databaseId, databaseId))
      .orderBy(desc(schema.operations.createdAt))
      .limit(limit)
      .all();
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
