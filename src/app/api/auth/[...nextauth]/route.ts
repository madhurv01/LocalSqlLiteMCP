import type { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveHandlers() {
  if (config.authMode !== "oauth") return null;
  try {
    const mod = await import("@/lib/auth-oauth");
    return mod.handlers;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const h = await resolveHandlers();
  if (!h) return new Response("OAuth is not enabled (set AUTH_MODE=oauth).", { status: 404 });
  return h.GET(req);
}

export async function POST(req: NextRequest) {
  const h = await resolveHandlers();
  if (!h) return new Response("OAuth is not enabled (set AUTH_MODE=oauth).", { status: 404 });
  return h.POST(req);
}
