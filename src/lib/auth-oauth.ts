/**
 * Auth.js (next-auth v5) wiring — only loaded when AUTH_MODE=oauth.
 * Configure at least one provider via env:
 *   AUTH_SECRET, AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { config } from "@/lib/config";

const providers: NextAuthConfig["providers"] = [];
if (config.githubId && config.githubSecret) {
  providers.push(GitHub({ clientId: config.githubId, clientSecret: config.githubSecret }));
}
if (config.googleId && config.googleSecret) {
  providers.push(Google({ clientId: config.googleId, clientSecret: config.googleSecret }));
}

export const authConfig: NextAuthConfig = {
  secret: config.authSecret || undefined,
  trustHost: true,
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/login" },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export const enabledProviders = providers.map((p) =>
  typeof p === "function" ? "unknown" : (p as { id: string }).id,
);
