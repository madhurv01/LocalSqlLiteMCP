"use client";

import { useEffect, useState } from "react";
import { GitBranch, Github, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";

interface MeResponse {
  authMode: string;
  authenticated: boolean;
}

export default function LoginPage() {
  const [state, setState] = useState<"loading" | "ready" | "redirecting">("loading");
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const me: MeResponse = await fetch("/api/me").then((r) => r.json());
      if (me.authenticated) {
        setState("redirecting");
        const from = new URLSearchParams(location.search).get("from") || "/";
        location.href = from;
        return;
      }
      if (me.authMode !== "oauth") {
        // header/single: no login page needed
        location.href = "/";
        return;
      }
      const list = await fetch("/api/auth/providers")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
      setProviders(Object.keys(list));
      setState("ready");
    })();
  }, []);

  const signIn = (id: string) => {
    const from = new URLSearchParams(location.search).get("from") || "/";
    location.href = `/api/auth/signin/${id}?callbackUrl=${encodeURIComponent(from)}`;
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <GitBranch className="h-5 w-5" />
        </div>
        <h1 className="mt-3 text-lg font-semibold">LocalDB Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to open your private workspace.
        </p>

        <div className="mt-5 space-y-2">
          {state !== "ready" && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {state === "ready" && providers.length === 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              No OAuth provider is configured. Set <code>AUTH_GITHUB_ID</code> /{" "}
              <code>AUTH_GITHUB_SECRET</code> (or Google) and <code>AUTH_SECRET</code>.
            </p>
          )}
          {state === "ready" &&
            providers.map((p) => (
              <Button key={p} className="w-full capitalize" onClick={() => signIn(p)}>
                {p === "github" ? <Github className="h-4 w-4" /> : null}
                Continue with {p}
              </Button>
            ))}
        </div>
      </Card>
    </div>
  );
}
