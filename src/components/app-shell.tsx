"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button, Card, Input, Separator, Textarea } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectDialog } from "@/components/connect-dialog";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { SchemaExplorer } from "@/components/schema-explorer";
import { OperationHistory, type OperationSummary } from "@/components/operation-history";
import { AssistantMessage, UserMessage } from "@/components/chat-message";
import { jsonFetch, streamAgent } from "@/lib/client-api";
import { emptyTurn, reduceTurn, turnFromMeta, type AgentTurn } from "@/lib/turn";
import { suggestFollowUps } from "@/lib/suggest";
import type { SchemaSnapshot } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";

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
  mcpTools: { name: string; description: string }[];
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
  const [cfg, setCfg] = useState<ConfigInfo | null>(null);
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

  // ---- bootstrap ----------------------------------------------------
  useEffect(() => {
    jsonFetch<ConfigInfo>("/api/config").then(setCfg).catch(() => {});
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
    [loadMessages, refreshOps, refreshSchema],
  );

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
      if (activeDb) {
        await refreshSchema(activeDb);
        await refreshOps(activeDb);
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
          {cfg && (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] md:inline-flex",
                cfg.usingFallback ? "text-warning" : "text-muted-foreground",
              )}
              title={`Configured: ${cfg.configuredProvider}`}
            >
              <Server className="h-3 w-3" /> planner: {cfg.activeProvider}
              {cfg.usingFallback && " (fallback)"}
            </span>
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
              <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
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
              </div>

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
              <TabsTrigger value="operations" className="flex-1">
                Operations
              </TabsTrigger>
              <TabsTrigger value="mcp" className="flex-1">
                MCP
              </TabsTrigger>
            </TabsList>
            <TabsContent value="schema" className="min-h-0 flex-1">
              <SchemaExplorer
                schema={schema}
                refreshing={schemaLoading}
                onRefresh={() => activeDb && refreshSchema(activeDb)}
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
