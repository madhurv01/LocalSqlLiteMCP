import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const databases = sqliteTable("databases", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** Absolute, validated path on disk. */
  path: text("path").notNull().unique(),
  createdAt: text("created_at").notNull().default(now),
  lastUsedAt: text("last_used_at").notNull().default(now),
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
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
