/**
 * In-process MCP client. The agent orchestrator calls the capability layer
 * directly (no transport overhead) but through the same registry the stdio
 * server exposes, so behaviour is identical.
 */
import { toolRegistry, type ToolName } from "./tools";
import { logger } from "@/lib/logger";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export class LocalMcpClient {
  readonly calls: ToolCallRecord[] = [];

  invoke<T = unknown>(name: ToolName, args: Record<string, unknown>): T {
    const def = toolRegistry[name];
    if (!def) throw new Error(`Unknown tool: ${name}`);
    const started = performance.now();
    try {
      const parsed = def.schema.parse(args);
      const result = (def.run as (a: unknown) => unknown)(parsed);
      const rec: ToolCallRecord = {
        name,
        args,
        ok: true,
        result,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      };
      this.calls.push(rec);
      logger.debug("mcp tool ok", { name, durationMs: rec.durationMs });
      return result as T;
    } catch (err) {
      const rec: ToolCallRecord = {
        name,
        args,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      };
      this.calls.push(rec);
      logger.warn("mcp tool error", { name, error: rec.error });
      throw err;
    }
  }

  listTools() {
    return Object.entries(toolRegistry).map(([name, def]) => ({
      name,
      description: def.description,
    }));
  }
}
