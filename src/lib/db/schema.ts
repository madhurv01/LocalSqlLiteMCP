import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const databases = sqliteTable("databases", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** Absolute, validated path on disk (the "main" branch file). */
  path: text("path").notNull().unique(),
  /** Currently checked-out branch. */
  activeBranchId: text("active_branch_id"),
  createdAt: text("created_at").notNull().default(now),
  lastUsedAt: text("last_used_at").notNull().default(now),
});

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  databaseId: text("database_id")
    .notNull()
    .references(() => databases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentBranchId: text("parent_branch_id"),
  /** Absolute path to this branch's own .db file (main points at databases.path). */
  filePath: text("file_path").notNull(),
  isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
  /** JSON SchemaSnapshot of the parent at fork time — used for merge conflict checks. */
  baseSchema: text("base_schema"),
  forkedFromOperationId: text("forked_from_operation_id"),
  status: text("status", { enum: ["active", "merged", "abandoned"] })
    .notNull()
    .default("active"),
  mergedIntoBranchId: text("merged_into_branch_id"),
  mergedAt: text("merged_at"),
  createdAt: text("created_at").notNull().default(now),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  databaseId: text("database_id")
    .notNull()
    .references(() => databases.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  createdAt: text("created_at").notNull().default(now),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  /** JSON blob: plan, events, operationId, etc. */
  meta: text("meta"),
  createdAt: text("created_at").notNull().default(now),
});

export const operations = sqliteTable("operations", {
  id: text("id").primaryKey(),
  databaseId: text("database_id")
    .notNull()
    .references(() => databases.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  /** Branch this operation ran on (null = legacy / main). */
  branchId: text("branch_id"),
  status: text("status", {
    enum: ["planned", "awaiting_confirmation", "executing", "completed", "failed", "rolled_back", "cancelled"],
  })
    .notNull()
    .default("planned"),
  intent: text("intent").notNull(),
  risk: text("risk").notNull().default("safe"),
  /** JSON AgentPlan */
  plan: text("plan").notNull(),
  /** JSON ExecutionResult | null */
  result: text("result"),
  /** JSON PreviewResult | null — sandbox preview captured before apply */
  previewResult: text("preview_result"),
  /** JSON SchemaSnapshot before */
  schemaBefore: text("schema_before"),
  /** JSON SchemaSnapshot after */
  schemaAfter: text("schema_after"),
  snapshotId: text("snapshot_id"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(now),
  completedAt: text("completed_at"),
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  databaseId: text("database_id")
    .notNull()
    .references(() => databases.id, { onDelete: "cascade" }),
  operationId: text("operation_id"),
  /** Absolute path to the .db backup file. */
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  reason: text("reason").notNull().default("pre-mutation"),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export type DatabaseRow = typeof databases.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
