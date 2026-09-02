import { z } from "zod";

export const chatRequestSchema = z.object({
  databaseId: z.string().min(1),
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
