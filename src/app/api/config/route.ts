import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { resolveProvider } from "@/lib/agent/providers";
import { toolRegistry } from "@/lib/mcp/tools";

export const runtime = "nodejs";

export async function GET() {
  const { provider, fellBack } = await resolveProvider();
  return NextResponse.json({
    configuredProvider: config.llmProvider,
    activeProvider: provider.name,
    usingFallback: fellBack,
    dbRoot: config.dbRoot,
    maxPreviewRows: config.maxPreviewRows,
    mcpTools: Object.entries(toolRegistry).map(([name, d]) => ({ name, description: d.description })),
  });
}
