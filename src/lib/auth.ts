import { config, slug } from "@/lib/config";
import { logger } from "@/lib/logger";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

const LOCAL: SessionUser = { id: "local", email: null, name: "Local" };

/** Thrown by requireUser; carries an HTTP Response to return directly. */
export class AuthError extends Error {
  constructor(
    readonly response: Response,
    message = "Unauthorized",
  ) {
    super(message);
  }
}

function unauthorized(detail: string): AuthError {
  return new AuthError(
    Response.json({ error: "Not authenticated", detail }, { status: 401 }),
  );
}

/** Resolve the user for a request, or null if not authenticated. */
export async function getRequestUser(req: Request): Promise<SessionUser | null> {
  if (config.authMode === "single") return LOCAL;

  if (config.authMode === "header") {
    for (const h of config.authHeaders) {
      const raw = req.headers.get(h);
      if (raw && raw.trim()) {
        const value = raw.trim();
        const email = value.includes("@") ? value.toLowerCase() : null;
        return { id: slug(value), email, name: email ? email.split("@")[0] : value };
      }
    }
    return null;
  }

  // oauth
  try {
    const { auth } = await import("./auth-oauth");
    const session = await auth();
    const u = session?.user;
    if (!u) return null;
    const key = (u.email || u.id || u.name || "").toString();
    if (!key) return null;
    return { id: slug(key), email: u.email?.toLowerCase() ?? null, name: u.name ?? null };
  } catch (err) {
    logger.error("oauth session resolution failed", { err: String(err) });
    return null;
  }
}

/** Resolve the user or throw an AuthError whose `.response` the route returns. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getRequestUser(req);
  if (user) return user;
  throw unauthorized(
    config.authMode === "header"
      ? `No identity header present (expected one of: ${config.authHeaders.join(", ")}). This deployment must sit behind an authenticating proxy.`
      : "Sign in to continue.",
  );
}

/**
 * Route-handler gate. Returns the user, or a Response the caller returns directly.
 *
 *   const gate = await authGate(req);
 *   if (gate instanceof Response) return gate;
 *   const user = gate;
 */
export async function authGate(req: Request): Promise<SessionUser | Response> {
  try {
    return await requireUser(req);
  } catch (err) {
    if (err instanceof AuthError) return err.response;
    throw err;
  }
}
