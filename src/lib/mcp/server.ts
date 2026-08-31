import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toolRegistry, type ToolName } from "./tools";

/**
 * Build an MCP server exposing the same capability layer the app uses.
 * External MCP clients (Claude Desktop, etc.) can connect via the stdio bin.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "localdb-agent", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Operate local SQLite databases safely. Always dry_run before execute. " +
        "Destructive statements require confirmDestructive=true and are snapshotted automatically.",
    },
  );

  for (const [name, def] of Object.entries(toolRegistry)) {
    server.tool(
      name,
      def.description,
      (def.schema as unknown as { shape: Record<string, unknown> }).shape,
      async (args: unknown) => {
        try {
          const parsed = def.schema.parse(args);
          const result = (def.run as (a: unknown) => unknown)(parsed);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: err instanceof Error ? err.message : String(err),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

// Re-export so tooling can introspect JSON schemas without a running server.
export function toolJsonSchemas() {
  return Object.fromEntries(
    (Object.keys(toolRegistry) as ToolName[]).map((name) => [
      name,
      zodToJsonSchema(toolRegistry[name].schema, name),
    ]),
  );
}
