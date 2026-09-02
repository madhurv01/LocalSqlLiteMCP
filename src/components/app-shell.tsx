"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Send,
  Server,
  TerminalSquare,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button, Card, Input, Separator, Textarea } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectDialog } from "@/components/connect-dialog";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { BranchSwitcher } from "@/components/branch-switcher";
import { BranchPanel } from "@/components/branch-panel";
import { SchemaExplorer } from "@/components/schema-explorer";
import { OperationHistory, type OperationSummary } from "@/components/operation-history";
import { AssistantMessage, UserMessage } from "@/components/chat-message";
import { jsonFetch, streamAgent } from "@/lib/client-api";
import { emptyTurn, reduceTurn, turnFromMeta, type AgentTurn } from "@/lib/turn";
import { suggestFollowUps } from "@/lib/suggest";
import type { BranchView, SchemaSnapshot } from "@/lib/types";
import { cn, formatBytes, relativeTime } from "@/lib/utils";

interface DbRow {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  lastUsedAt: string;
}
interface ConvRow {
  id: string;
  title: string;
  createdAt: string;
}
interface MsgRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}
interface ConfigInfo {
  configuredProvider: string;
  activeProvider: string;
  usingFallback: boolean;
  authMode: string;
  mcpTools: { name: string; description: string }[];
}
interface MeInfo {
  authMode: string;
  authenticated: boolean;
  user: { id: string; email: string | null; name: string | null } | null;
  quota: {
    databases: { used: number; limit: number };
    disk: { usedBytes: number; limitBytes: number };
  } | null;
}

const EXAMPLES = [
  "Create a users table with id, name, email and insert 10 sample users",
  "Show all users",
  "Add a column age to users",
  "Delete from users where id > 5",
];

export function AppShell() {
  const [dbs, setDbs] = useState<DbRow[]>([]);
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaSnapshot | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [cfg, setCfg] = useState<ConfigInfo | null>(null);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [input, setInput] = useState("");
  const [liveTurn, setLiveTurn] = useState<AgentTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { setTheme, resolvedTheme } = useTheme();

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const refreshMe = useCallback(() => {
    jsonFetch<MeInfo>("/api/me").then(setMe).catch(() => {});
  }, []);

  // ---- bootstrap ----------------------------------------------------
  useEffect(() => {
    jsonFetch<ConfigInfo>("/api/config").then(setCfg).catch(() => {});
    refreshMe();
    jsonFetch<{ databases: DbRow[] }>("/api/databases")
      .then((r) => {
        setDbs(r.databases);
        if (r.databases[0]) selectDb(r.databases[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveTurn]);

  const refreshSchema = useCallback(async (dbId: string) => {
    setSchemaLoading(true);
    try {
      const r = await jsonFetch<{ schema: SchemaSnapshot }>(`/api/databases/${dbId}/schema`);
      setSchema(r.schema);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  const refreshOps = useCallback(async (dbId: string) => {
    const r = await jsonFetch<{ operations: OperationSummary[] }>(
      `/api/databases/${dbId}/operations`,
    );
    setOperations(r.operations);
  }, []);

  const refreshBranches = useCallback(async (dbId: string) => {
    try {
      const r = await jsonFetch<{ branches: BranchView[] }>(`/api/databases/${dbId}/branches`);
      setBranches(r.branches);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const r = await jsonFetch<{ messages: MsgRow[] }>(`/api/conversations/${convId}`);
    setMessages(r.messages);
  }, []);

  const selectDb = useCallback(
    async (dbId: string) => {
      setActiveDb(dbId);
      setSchema(null);
      setMessages([]);
      setLiveTurn(null);
      await refreshSchema(dbId);
      await refreshOps(dbId);
      await refreshBranches(dbId);
      const r = await jsonFetch<{ conversations: ConvRow[] }>(
        `/api/conversations?databaseId=${dbId}`,
      );
      setConvs(r.conversations);
      if (r.conversations[0]) {
        setActiveConv(r.conversations[0].id);
        await loadMessages(r.conversations[0].id);
      } else {
        setActiveConv(null);
      }
    },
    [loadMessages, refreshOps, refreshSchema, refreshBranches],
  );

  const activeBranch = useMemo(() => branches.find((b) => b.isActive) ?? null, [branches]);

  async function switchBranch(branchId: string) {
    if (!activeDb || busy) return;
    setBusy(true);
    try {
      const r = await jsonFetch<{ branch: { name: string }; branches: BranchView[] }>(
        `/api/databases/${activeDb}/branches/${branchId}/activate`,
        { method: "POST", body: "{}" },
      );
      setBranches(r.branches);
      setLiveTurn(null);
      await refreshSchema(activeDb);
      await refreshOps(activeDb);
      notify(`Switched to ${r.branch.name}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createBranch(name: string) {
    if (!activeDb) return;
    setBusy(true);
    try {
      const r = await jsonFetch<{ branch: { id: string; name: string }; branches: BranchView[] }>(
        `/api/databases/${activeDb}/branches`,
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setBranches(r.branches);
      notify(`Created branch ${r.branch.name} — switching…`);
      await switchBranch(r.branch.id);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function discardBranch(branchId: string) {
    if (!activeDb) return;
    if (!confirm("Discard this branch and its database file? This cannot be undone.")) return;
    setBusy(true);
    try {
      const r = await jsonFetch<{ switchedTo: string | null; branches: BranchView[] }>(
        `/api/databases/${activeDb}/branches/${branchId}`,
        { method: "DELETE" },
      );
      setBranches(r.branches);
      if (r.switchedTo) {
        await refreshSchema(activeDb);
        await refreshOps(activeDb);
        notify("Branch discarded — back on main");
      } else {
        notify("Branch discarded");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function afterMerge() {
    if (!activeDb) return;
    await refreshBranches(activeDb);
    await refreshSchema(activeDb);
    await refreshOps(activeDb);
  }

  const selectConv = useCallback(
    async (id: string) => {
      setActiveConv(id);
      setLiveTurn(null);
      await loadMessages(id);
    },
    [loadMessages],
  );

  async function newConversation() {
    if (!activeDb) return;
    const r = await jsonFetch<{ conversation: ConvRow }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ databaseId: activeDb }),
    });
    setConvs((c) => [r.conversation, ...c]);
    setActiveConv(r.conversation.id);
    setMessages([]);
  }

  async function deleteConversation(id: string) {
    await jsonFetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConvs((c) => c.filter((x) => x.id !== id));
    if (activeConv === id) {
      setActiveConv(null);
      setMessages([]);
    }
  }

  // ---- send -------------------------------------------------------
  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || !activeDb || busy) return;
    setInput("");
    setBusy(true);

    const optimisticUser: MsgRow = {
      id: `tmp_${Date.now()}`,
      role: "user",
      content: text,
      meta: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    let turn = emptyTurn(`live_${Date.now()}`);
    setLiveTurn(turn);

    try {
      await streamAgent(
        "/api/agent/stream",
        { databaseId: activeDb, conversationId: activeConv ?? undefined, message: text },
        (evt) => {
          turn = reduceTurn(turn, evt);
          setLiveTurn({ ...turn });
        },
      );
    } catch (e) {
      turn = reduceTurn(turn, {
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      setLiveTurn({ ...turn });
    } finally {
      setBusy(false);
      refreshMe();
      if (activeDb) {
        await refreshSchema(activeDb);
        await refreshOps(activeDb);
        await refreshBranches(activeDb);
        const r = await jsonFetch<{ conversations: ConvRow[] }>(
          `/api/conversations?databaseId=${activeDb}`,
        );
        setConvs(r.conversations);
        const convId = activeConv ?? r.conversations[0]?.id ?? null;
        if (convId) {
          setActiveConv(convId);
          await loadMessages(convId);
        }
      }
      // keep the live turn only if awaiting confirmation (needs action buttons)
      setLiveTurn((lt) => (lt && lt.status === "awaiting_confirmation" ? lt : null));
    }
  }

  // ---- confirm / cancel / undo -------------------------------
  async function confirmTurn(turn: AgentTurn, approve: boolean) {
    if (!turn.operationId) return;
    setBusy(true);
    try {
      if (!approve) {
        await jsonFetch(`/api/operations/${turn.operationId}/confirm`, {
          method: "POST",
          body: JSON.stringify({ approve: false }),
        });
        setLiveTurn({ ...turn, status: "cancelled" });
      } else {
        let t: AgentTurn = { ...turn, status: "executing" };
        setLiveTurn(t);
        await streamAgent(
          `/api/operations/${turn.operationId}/confirm`,
          { approve: true },
          (evt) => {
            t = reduceTurn(t, evt);
            setLiveTurn({ ...t });
          },
        );
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (activeDb) {
        await refreshSchema(activeDb);
        await refreshOps(activeDb);
      }
      if (activeConv) await loadMessages(activeConv);
      setLiveTurn(null);
    }
  }

  async function undo(operationId: string) {
    setBusy(true);
    try {
      const r = await jsonFetch<{ ok: boolean; message: string }>(
        `/api/operations/${operationId}/undo`,
        { method: "POST" },
      );
      notify(r.message);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (activeDb) {
        await refreshSchema(activeDb);
        await refreshOps(activeDb);
      }
      if (activeConv) await loadMessages(activeConv);
    }
  }

  const activeDbRow = useMemo(() => dbs.find((d) => d.id === activeDb) ?? null, [dbs, activeDb]);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user")?.content ?? null,
    [messages],
  );

  // ---- command palette --------------------------------------------
  const paletteActions = useMemo<PaletteAction[]>(() => {
    const acts: PaletteAction[] = [
      {
        id: "connect",
        label: "Connect a database",
        group: "Database",
        icon: Database,
        run: () => setConnectOpen(true),
      },
      {
        id: "new-conv",
        label: "New conversation",
        hint: "⌘⇧O",
        group: "Conversation",
        icon: MessageSquarePlus,
        run: () => newConversation(),
      },
      {
        id: "refresh-schema",
        label: "Refresh schema",
        group: "Database",
        icon: RefreshCw,
        run: () => activeDb && refreshSchema(activeDb),
      },
      {
        id: "focus-input",
        label: "Focus the prompt box",
        group: "Navigation",
        icon: TerminalSquare,
        run: () => inputRef.current?.focus(),
      },
      {
        id: "theme",
        label: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`,
        group: "Appearance",
        icon: Moon,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];
    if (lastUserMessage && !busy) {
      acts.push({
        id: "rerun",
        label: `Re-run: "${lastUserMessage.slice(0, 48)}"`,
        group: "Conversation",
        icon: RotateCw,
        run: () => send(lastUserMessage),
      });
    }
    for (const d of dbs) {
      acts.push({
        id: `db-${d.id}`,
        label: `Open ${d.label}`,
        hint: d.id === activeDb ? "current" : undefined,
        group: "Switch database",
        icon: Database,
        run: () => selectDb(d.id),
      });
    }
    return acts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbs, activeDb, resolvedTheme, lastUserMessage, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (activeDb) newConversation();
      } else if (
        e.key === "ArrowUp" &&
        !busy &&
        !input &&
        document.activeElement === inputRef.current &&
        lastUserMessage
      ) {
        e.preventDefault();
        setInput(lastUserMessage);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDb, busy, input, lastUserMessage]);

  // Build render list: persisted messages, pairing assistant meta into turns.
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null,
    [messages],
  );
  const rendered = useMemo(() => {
    const items: { key: string; node: React.ReactNode }[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        items.push({ key: m.id, node: <UserMessage content={m.content} /> });
      } else if (m.role === "assistant") {
        const turn = turnFromMeta(m.id, m.meta);
        const suggestions =
          !busy && m.id === lastAssistantId && turn && turn.status === "done"
            ? suggestFollowUps(turn, schema)
            : undefined;
        items.push({
          key: m.id,
          node: (
            <AssistantMessage
              turn={turn}
              content={m.content}
              busy={busy}
              suggestions={suggestions}
              onSuggestion={(t) => send(t)}
              onConfirm={() => turn && confirmTurn(turn, true)}
              onCancel={() => turn && confirmTurn(turn, false)}
              onUndo={() => turn?.operationId && undo(turn.operationId)}
            />
          ),
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, busy, lastAssistantId, schema]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="flex items-center gap-2 font-semibold">
          <GitBranch className="h-4 w-4 text-primary" />
          LocalDB Agent
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Git for AI database operations
        </span>
        <div className="ml-auto flex items-center gap-2">
          {activeDb && branches.length > 0 && (
            <BranchSwitcher
              branches={branches}
              busy={busy}
              onSwitch={switchBranch}
              onCreate={createBranch}
            />
          )}
          {cfg && (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] lg:inline-flex",
                cfg.usingFallback ? "text-warning" : "text-muted-foreground",
              )}
              title={`Configured: ${cfg.configuredProvider}`}
            >
              <Server className="h-3 w-3" /> {cfg.activeProvider}
              {cfg.usingFallback && " (fallback)"}
            </span>
          )}
          {me && me.authMode !== "single" && me.user && (
            <div className="hidden items-center gap-2 md:flex">
              {me.quota && (
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                  title="Your workspace usage"
                >
                  {me.quota.databases.used}/{me.quota.databases.limit} DBs ·{" "}
                  {formatBytes(me.quota.disk.usedBytes)}/{formatBytes(me.quota.disk.limitBytes)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
                <span className="max-w-[140px] truncate">{me.user.email ?? me.user.name}</span>
              </span>
              {me.authMode === "oauth" && (
                <button
                  onClick={() => {
                    window.location.href = "/api/auth/signout";
                  }}
                  className="text-xs text-muted-foreground underline"
                >
                  Sign out
                </button>
              )}
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r lg:flex">
          <div className="p-2">
            <ConnectDialog
              onConnected={(id) =>
                jsonFetch<{ databases: DbRow[] }>("/api/databases").then((r) => {
                  setDbs(r.databases);
                  selectDb(id);
                })
              }
              trigger={
                <Button variant="secondary" className="w-full justify-start" size="sm">
                  <Plus className="h-3.5 w-3.5" /> Connect database
                </Button>
              }
            />
          </div>
          <div className="scrollbar-thin max-h-40 overflow-y-auto px-2">
            {dbs.map((d) => (
              <button
                key={d.id}
                onClick={() => selectDb(d.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  activeDb === d.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{d.label}</span>
                {!d.exists && <span className="ml-auto text-[10px] text-destructive">missing</span>}
              </button>
            ))}
          </div>
          <Separator />
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conversations
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={!activeDb}
              onClick={newConversation}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-2">
            {convs.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  activeConv === c.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => selectConv(c.id)}>
                  {c.title}
                </button>
                <button
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => deleteConversation(c.id)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
            {!convs.length && (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations.</p>
            )}
          </div>
        </aside>

        {/* center chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!activeDb ? (
            <EmptyState onConnected={(id) => selectDb(id)} setDbs={setDbs} />
          ) : (
            <>
              <AnimatePresence>
                {activeBranch && !activeBranch.isMain && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex items-center gap-2 overflow-hidden border-b border-primary/30 bg-primary/10 px-4 py-1.5 text-xs text-primary"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    You are on branch <span className="font-semibold">{activeBranch.name}</span> —
                    changes here don&apos;t touch main until you merge.
                    <button
                      className="ml-auto underline underline-offset-2"
                      onClick={() => {
                        const main = branches.find((b) => b.isMain);
                        if (main) switchBranch(main.id);
                      }}
                    >
                      back to main
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.div
                key={activeBranch?.id ?? "nb"}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                ref={scrollRef}
                className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4"
              >
                {rendered.length === 0 && !liveTurn && (
                  <div className="mx-auto max-w-lg pt-10 text-center">
                    <h2 className="text-lg font-semibold">Operate {activeDbRow?.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Describe a change in plain English. The agent will inspect, plan, safety-check,
                      preview, execute in a transaction, verify, and let you roll back.
                    </p>
                    <div className="mt-4 grid gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          onClick={() => setInput(ex)}
                          className="rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/50"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {rendered.map((r) => (
                  <div key={r.key}>{r.node}</div>
                ))}
                {liveTurn && (
                  <AssistantMessage
                    turn={liveTurn}
                    busy={busy}
                    onConfirm={() => confirmTurn(liveTurn, true)}
                    onCancel={() => confirmTurn(liveTurn, false)}
                    onUndo={() => liveTurn.operationId && undo(liveTurn.operationId)}
                  />
                )}
              </motion.div>

              <div className="shrink-0 border-t p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="e.g. Create a products table with name, price and seed 20 rows   ·   ⌘K for commands"
                    className="max-h-40 min-h-[44px] resize-none"
                    disabled={busy}
                  />
                  <Button onClick={() => send()} disabled={busy || !input.trim()} size="icon" className="h-11 w-11">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </main>

        {/* right inspector */}
        <aside className="hidden w-80 shrink-0 flex-col border-l xl:flex">
          <Tabs defaultValue="schema" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-2">
              <TabsTrigger value="schema" className="flex-1">
                Schema
              </TabsTrigger>
              <TabsTrigger value="branches" className="flex-1">
                Branches{branches.length > 1 ? ` (${branches.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="operations" className="flex-1">
                Ops
              </TabsTrigger>
              <TabsTrigger value="mcp" className="flex-1">
                MCP
              </TabsTrigger>
            </TabsList>
            <TabsContent value="schema" className="min-h-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeBranch?.id ?? "none"}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                  className="h-full"
                >
                  <SchemaExplorer
                    schema={schema}
                    refreshing={schemaLoading}
                    onRefresh={() => activeDb && refreshSchema(activeDb)}
                  />
                </motion.div>
              </AnimatePresence>
            </TabsContent>
            <TabsContent value="branches" className="min-h-0 flex-1">
              <BranchPanel
                databaseId={activeDb}
                branches={branches}
                busy={busy}
                onSwitch={switchBranch}
                onCreate={createBranch}
                onDiscard={discardBranch}
                onMerged={afterMerge}
              />
            </TabsContent>
            <TabsContent value="operations" className="min-h-0 flex-1 overflow-hidden">
              <OperationHistory operations={operations} onUndo={undo} busy={busy} />
            </TabsContent>
            <TabsContent value="mcp" className="min-h-0 flex-1 overflow-y-auto p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                The same capability layer is exposed as an MCP server. Run{" "}
                <code className="font-mono">npm run mcp:stdio</code> to connect external clients.
              </p>
              <ul className="space-y-1.5">
                {cfg?.mcpTools.map((t) => (
                  <li key={t.name} className="rounded-md border px-2 py-1.5 text-xs">
                    <span className="font-mono font-semibold text-primary">{t.name}</span>
                    <p className="text-muted-foreground">{t.description}</p>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
          {activeDbRow && (
            <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
              <p className="truncate font-mono">{activeDbRow.path}</p>
              <p>updated {relativeTime(activeDbRow.lastUsedAt)}</p>
            </div>
          )}
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-card px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} />
      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={(id) =>
          jsonFetch<{ databases: DbRow[] }>("/api/databases").then((r) => {
            setDbs(r.databases);
            selectDb(id);
          })
        }
      />
    </div>
  );
}

function EmptyState({
  onConnected,
  setDbs,
}: {
  onConnected: (id: string) => void;
  setDbs: (d: DbRow[]) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-md p-6 text-center">
        <Database className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">No database connected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a local <code>.db</code> / <code>.sqlite</code> file or create a fresh one to start
          operating it with natural language.
        </p>
        <div className="mt-4">
          <ConnectDialog
            onConnected={(id) =>
              jsonFetch<{ databases: DbRow[] }>("/api/databases").then((r) => {
                setDbs(r.databases);
                onConnected(id);
              })
            }
            trigger={
              <Button className="w-full">
                <Plus className="h-4 w-4" /> Connect a database
              </Button>
            }
          />
        </div>
      </Card>
    </div>
  );
}
