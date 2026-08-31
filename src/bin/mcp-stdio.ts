#!/usr/bin/env node
/**
 * Standalone MCP server over stdio. Point any MCP client at this:
 *
 *   {
 *     "mcpServers": {
 *       "localdb-agent": {
 *         "command": "npx",
 *         "args": ["tsx", "src/bin/mcp-stdio.ts"],
 *         "env": { "LOCALDB_DB_ROOT": "/absolute/path/to/databases" }
 *       }
 *     }
 *   }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "@/lib/mcp/server";

async function main() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("localdb-agent MCP server ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
