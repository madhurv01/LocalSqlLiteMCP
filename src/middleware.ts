import { NextResponse, type NextRequest } from "next/server";

/**
 * Only active for AUTH_MODE=oauth: bounce unauthenticated page loads to /login.
 * API routes do their own enforcement (node runtime); this is just UX for the
 * browser. Runs on the edge runtime — no DB / node:fs access here.
 */
export function middleware(req: NextRequest) {
  if ((process.env.AUTH_MODE || "").toLowerCase() !== "oauth") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  // Auth.js sets one of these cookies once signed in.
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token") ||
    req.cookies.has("next-auth.session-token") ||
    req.cookies.has("__Secure-next-auth.session-token");

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
