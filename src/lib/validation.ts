import { z } from "zod";

export const connectDbSchema = z.object({
  /** Path relative to LOCALDB_DB_ROOT, or an absolute path inside it. */
  path: z.string().min(1).max(1024),
  label: z.string().min(1).max(120).optional(),
});

export const createDbSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9 _-]+$/, "letters, numbers, spaces, _ and - only"),
});

export const chatRequestSchema = z.object({
  databaseId: z.string().min(1),
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

export const confirmOperationSchema = z.object({
  operationId: z.string().min(1),
  approve: z.boolean(),
});

export const undoSchema = z.object({
  operationId: z.string().min(1),
});

export const mcpQueryToolSchema = z.object({
  databasePath: z.string().min(1),
  sql: z.string().min(1),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const mcpExecuteToolSchema = z.object({
  databasePath: z.string().min(1),
  statements: z.array(z.string().min(1)).min(1),
  confirmDestructive: z.boolean().default(false),
  snapshot: z.boolean().default(true),
});

export type ConnectDbInput = z.infer<typeof connectDbSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
