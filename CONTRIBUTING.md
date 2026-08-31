# Contributing

Thanks for taking a look. LocalDB Agent is a local-first tool — everything runs on your
machine against local SQLite files.

## Setup

```bash
npm install
cp .env.example .env    # optional; defaults work offline
npm run seed            # builds databases/demo.db
npm run dev
```

## Before opening a PR

```bash
npm run typecheck   # tsc --noEmit, must be clean
npm test            # vitest — safety model, path safety, sandbox, full pipeline
npm run lint
npm run build       # must succeed
```

## Layout

| Path | Responsibility |
|---|---|
| `src/lib/sqlite/` | connection isolation, path safety, introspection, diff, safety model, executor, snapshots, sandbox preview |
| `src/lib/mcp/` | the canonical capability layer (`tools.ts`) + MCP server + in-process client |
| `src/lib/agent/` | LLM providers (heuristic / ollama / anthropic / openai) + the pipeline orchestrator |
| `src/lib/db/` | Drizzle schema + app metadata database |
| `src/app/api/` | Next.js route handlers (SSE for the agent stream) |
| `src/components/` | UI — consumes SSE, never touches SQLite directly |

## Ground rules

- Never let SQL bypass the safety model. New statement kinds go through
  `assessScript` in `src/lib/sqlite/safety.ts`.
- Any new database capability is added to the `toolRegistry` in
  `src/lib/mcp/tools.ts` so the standalone MCP server exposes it too.
- Destructive changes must remain gated behind an explicit confirmation and an
  automatic snapshot.
- Keep secrets out of the repo — configuration is read from `process.env` only.

## Commits

Conventional-ish commit subjects are appreciated (`feat:`, `fix:`, `docs:`, `refactor:`,
`test:`). Keep unrelated changes in separate PRs.
