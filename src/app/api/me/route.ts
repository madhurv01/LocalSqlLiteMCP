import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getRequestUser } from "@/lib/auth";
import { quotaStatus } from "@/lib/quota";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  return NextResponse.json({
    authMode: config.authMode,
    authenticated: !!user,
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    quota: user ? quotaStatus(user.id) : null,
  });
}
