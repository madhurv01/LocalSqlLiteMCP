
<img
    src="LocalDBAgent.png"
    alt="LocalDB Agent"
    width="100%"
  />


# LocalDB Agent

**Git for AI database operations.** A local-first AI database operator that connects to
SQLite databases through the **Model Context Protocol (MCP)** and lets you manage them
safely with natural language.

Type *"create a users table with id, name, email and 10 sample rows"* or
*"delete every cancelled order"* and instead of blindly running SQL, the app runs an
**agentic pipeline**:

```
Understand → Inspect → Plan → Safety Check → Preview → Confirm → Execute → Verify → Complete
```

Every step streams into an animated timeline. You see the generated SQL as it's drafted,
the affected tables and rows, a risk score, the **real** before/after schema and row diff
(computed on a throwaway clone — see [Sandbox preview](#sandbox-preview)), verification
query results, and execution timing. Destructive changes require an explicit confirmation,
run inside a single transaction, and are protected by an automatic snapshot so any
operation — **including a branch merge** — can be rolled back with one click.

It is **not** a text-to-SQL chatbot.

---

## Contents

- [Why](#why)
- [Highlights](#highlights)
- [Quick start](#quick-start)
- [A request, start to finish](#a-request-start-to-finish)
- [What the built-in planner handles](#what-the-built-in-planner-handles)
- [Database branching](#database-branching)
- [Sandbox preview](#sandbox-preview)
- [Safety model](#safety-model)
- [Multi-user](#multi-user)
- [Configuration](#configuration)
- [Deploying (incl. free / 24-7)](#deploying)
- [Using the MCP server standalone](#using-the-mcp-server-standalone)
- [Architecture](#architecture)
- [Data & files](#data--files)
- [Scripts & tests](#scripts--tests)
- [FAQ](#faq)
- [License](#license)

---

## Why

Letting an LLM run SQL against a real database is a bad trade: one mis-scoped `UPDATE` or a
`DROP TABLE` and the data is gone. The usual "text-to-SQL" tools generate a statement and
hope. LocalDB Agent instead treats each request the way a careful engineer would:

1. **read the schema first** so the plan is grounded in what actually exists,
2. **run the plan on a disposable copy** and show you exactly what it does — real row
   counts, real diffs, real failures — before touching your data,
3. **gate anything destructive** behind a confirmation with those real numbers in front of
   you,
4. **wrap execution in a transaction** and **snapshot first**, so undo is always available,
5. and expose the whole capability layer as an **MCP server** so the same guarantees apply
   whether you drive it from the web UI or from Claude Desktop / Cursor / any MCP client.

The result feels like version control for database changes rather than a chat window that
occasionally corrupts your database.

---

## Highlights

| | |
|---|---|
| **Agentic workflow** | 9-stage pipeline with streamed reasoning, streamed SQL, and a live timeline |
| **Database branching** | fork the DB into a named branch, let the agent run wild, diff branch vs. main, then merge the good version back or discard it — like `git branch` for your data |
| **Truthful preview** | every plan runs first against a throwaway in-memory clone — you see the real result, real schema/row diff, real verification outcomes, real failures — before anything touches your database |
| **Safe by construction** | static SQL analysis, risk scoring, hard-blocked statements, parameterised reads, transaction boundaries, read/write separation |
| **Snapshots & undo** | online-backup checkpoint before every mutation; one-click rollback — a merge is undoable too |
| **Schema intelligence** | explorer with tables / columns / row counts / indexes / FKs, and structural before/after diffs |
| **Command palette** | ⌘K / Ctrl-K for connect, switch DB, new conversation, re-run, theme |
| **MCP-native** | the database capability layer is a standalone MCP server — external clients get the same guarantees |
| **Single- or multi-user** | zero-auth by default; flip `AUTH_MODE` to `header` / `oauth` for private per-user workspaces with browser uploads and quotas |
| **Free by default** | offline rule-based planner needs no API key; optional Ollama / Anthropic / OpenAI |
| **Polished UI** | Next.js + shadcn-style components + Framer Motion, dark/light, responsive |

### Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind + shadcn-style UI · Framer Motion ·
`@modelcontextprotocol/sdk` · `better-sqlite3` · Drizzle ORM (query builder) · Zod ·
Server-Sent Events · Vitest

---

## Quick start

```bash
npm install
cp .env.example .env          # optional — the defaults work with zero config
npm run seed                  # builds databases/demo.db (customers / products / orders)
npm run dev                   # http://localhost:3000
```

Open the app, connect `demo.db`, and try any of these:

**Read / explore**
> *list all tables* · *describe orders* · *how many customers do we have* ·
> *show all customers in Berlin* · *show orders where status = 'shipped'*

**Schema**
> *create a suppliers table with id, name, email and 10 sample rows* ·
> *add a column phone to customers* · *rename table products to catalog* ·
> *rename column status to state in orders* · *drop the suppliers table*

**Data**
> *insert 25 sample rows into products* ·
> *set status to shipped in orders where id = 3* ·
> *delete from orders where status = 'cancelled'*  ← asks for confirmation

**Raw SQL** (passed through verbatim, still safety-checked and previewed)
> *SELECT product_id, COUNT(\*) FROM orders GROUP BY product_id ORDER BY 2 DESC*

### Production build

```bash
npm run build
npm start                     # = node .next/standalone/server.js  (PORT, default 3000)
```

The app-metadata database is created and kept current automatically on first run — there is
no separate migration step.

### Docker

```bash
docker compose up --build     # http://localhost:3000
```

`./databases` is bind-mounted; app metadata + snapshots persist in the `localdb-data`
volume.

---

## A request, start to finish

What you actually see when you send *"create a suppliers table with id, name, email and
insert 5 sample suppliers"*:

| Stage | What happens | What you see |
|---|---|---|
| **Understand** | the request is echoed back | ✓ Understood |
| **Inspect** | `schema_snapshot` reads every table, column and row count | *Found 3 tables — customers (12), orders (30), products (8)* |
| **Plan** | the planner (offline rules, or an LLM) turns the request into concrete SQLite statements + verification queries | reasoning streams in; each SQL statement appears as it's drafted |
| **Safety Check** | the statement splitter classifies each statement, scores risk, checks the hard-block list | *Risk: LOW — 0 destructive statements* |
| **Preview** | the whole plan runs on an **in-memory clone** of the DB | *1 table changed · +5 −0 rows · checks 2/2* with a real schema diff + sample inserted rows |
| **Confirm** | *(destructive / high-risk plans only)* the pipeline stops and persists an `awaiting_confirmation` operation | **Apply to database** / **Cancel**, with the real impact numbers |
| **Execute** | the identical SQL runs on the real DB in one transaction; a snapshot is taken first | *Executed 2 statements in 0.9 ms* |
| **Verify** | the plan's verification `SELECT`s run against the result | ✓ *"suppliers" has 5 rows* |
| **Complete** | the operation is recorded; schema diff + result are shown | **Undo / rollback** button; follow-up suggestion chips |

If the plan would fail (a foreign-key violation, a bad column name, a typo) the sandbox
catches it at **Preview** — the pipeline stops, nothing is written, and no mutating
operation is created.

---

## What the built-in planner handles

With `LLM_PROVIDER=heuristic` (the default) there is **no API key and no network call** —
a rule-based intent router maps natural language to real SQLite. It recognises:

| Intent | Example phrasings |
|---|---|
| list tables / count tables / schema overview | *list all tables*, *what tables are there*, *how many tables*, *show me the schema* |
| describe a table | *describe orders*, *columns of customers*, *the ddl for orders* |
| count rows | *how many rows in orders*, *count the records in customers*, *how many customers do we have* |
| select rows | *show all users*, *list orders where status = 'x'*, *show customers in Berlin* (guesses the column), *first 20 products* |
| create table (+ optional seed) | *create me a table named test_env with two fields name, dob, fill 10 rows of dummy data* |
| add / drop / rename column | *add a column age to users*, *drop column city from customers*, *rename column status to state in orders* |
| rename / drop table | *rename table products to catalog*, *rename products table to catalog*, *drop the suppliers table* |
| insert rows | *insert 20 sample rows into products* (sample values are realistic and collision-free with existing rows) |
| update rows | *set status to shipped in orders where id = 3*, *update orders set quantity = 1* |
| delete rows | *delete from orders where status = 'cancelled'*, *delete every row from logs* |
| raw SQL | anything starting with a real `SELECT` / `INSERT` / `CREATE TABLE` / … shape — passed through verbatim, still safety-checked and previewed |

Anything it can't map is surfaced honestly ("try phrasing it as an operation…") rather than
guessed. For open-ended requests set `LLM_PROVIDER=ollama` (free, local) or `anthropic` /
`openai`. If a configured LLM is unreachable the app automatically falls back to the offline
planner and tells you in the UI.

---

## Database branching

Completes the "Git for database operations" metaphor. Everything still runs through the
pipeline — branching just changes which `.db` file is active.

- **Fork** — copies the active branch's file (`VACUUM INTO`) into `data/branches/`,
  instantly, and records the parent's schema at fork time. The parent is untouched.
- **Switch** — the branch switcher in the header swaps the file the agent operates on.
  History, undo, schema and operations are all branch-scoped.
- **Compare** — branch vs. parent: schema diff, per-table row-count deltas, and the list of
  operations that ran on the branch.
- **Merge** — checks the parent hasn't diverged structurally since the fork (else it flags a
  conflict), **previews** the combined statements on a sandbox copy of the parent, then on
  confirm replays them onto the parent in one transaction **with a snapshot** — so the merge
  itself is undoable. You land back on the parent branch.
- **Discard** — deletes the branch file and its operations; `main` never knew it existed.

> Try: *fork a branch* → *"delete half the customers"* → **Compare** shows `customers: 12 → 6`
> → **Merge** or **Discard**.

---

## Sandbox preview

`src/lib/sqlite/sandbox.ts` makes the Preview stage *truthful* instead of a static guess:

1. clone the database with `VACUUM INTO` a scratch file,
2. load the bytes into a **private in-memory SQLite instance**, delete the scratch file,
3. run the plan in a transaction on the clone,
4. capture the real `StatementResult`s, a real `SchemaDiff`, a **row-level diff** (added /
   removed / changed rows keyed on `rowid`, with samples), and real verification results,
5. discard the clone. Nothing is written back.

If the plan errors, the pipeline stops at Preview and never creates a mutating operation.
Databases larger than `LOCALDB_SANDBOX_MAX_MB` (default 200) skip the clone and fall back to
static analysis, with a note in the UI.

---

## Safety model

- **Hard-blocked** regardless of confirmation: `ATTACH` / `DETACH DATABASE`,
  `load_extension`, `PRAGMA writable_schema`, `VACUUM INTO`.
- **Risk scoring**: `safe → low → moderate → high → critical`. `UPDATE` / `DELETE` without a
  `WHERE` jump to `high`; `DROP` is `critical`.
- **Confirmation gate**: any destructive statement or `high`+ risk stops the pipeline and
  persists an `awaiting_confirmation` operation until you approve (or set
  `LOCALDB_REQUIRE_CONFIRM_ALL=true` to gate every mutation).
- **Transactions**: every batch runs in one `better-sqlite3` transaction — any failure rolls
  the whole batch back, nothing is committed.
- **Snapshots**: a physical WAL-truncated file copy is taken before mutations; **Undo**
  closes connections, restores the file, and marks the snapshot consumed.
- **Reads** are parameterised and run on a `readonly` connection, separate from the
  read/write pool.
- **Path safety**: user-supplied paths are confined to the workspace root; traversal,
  absolute paths outside it, non-`.db`/`.sqlite` extensions and URIs are rejected.

---

## Multi-user

Default is `AUTH_MODE=single` — no login, one shared `local` workspace, exactly the current
behaviour. Set `AUTH_MODE` to turn on isolation:

| Mode | Identity source | Setup |
|---|---|---|
| `single` | none (user `local`) | nothing |
| `header` | a trusted reverse-proxy header (`Cf-Access-Authenticated-User-Email`, `X-Auth-Request-Email`, …) | put Cloudflare Access / oauth2-proxy / nginx `auth_request` in front |
| `oauth` | GitHub / Google via Auth.js | `AUTH_SECRET` + `AUTH_GITHUB_ID` / `_SECRET` (and/or Google) |

In `header` / `oauth` mode:

- each user gets a private directory `$LOCALDB_DB_ROOT/u/<id>/` and only ever sees and
  operates their own databases — every API route is ownership-checked (cross-user access
  returns `404`),
- users **upload** a `.db` / `.sqlite` from their computer (validated by SQLite magic bytes,
  size-capped) or **create** one,
- per-user quotas — `LOCALDB_MAX_DBS_PER_USER` (10), `LOCALDB_MAX_DB_MB` (50),
  `LOCALDB_MAX_USER_MB` (200) — and an agent-request rate limit
  (`LOCALDB_AGENT_RATE` / `_WINDOW_S`) are enforced,
- the header shows the signed-in identity and workspace usage.

Run **one instance** — the connection pool and local files are per-process and
`better-sqlite3` is synchronous; scale up, not out.

Full recipes (Cloudflare Access, oauth2-proxy, Auth.js) are in
[DEPLOYMENT.md](DEPLOYMENT.md#5-multi-user).

---

## Configuration

All optional — see [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `LOCALDB_DB_ROOT` | `./databases` | workspace root; paths outside it are rejected |
| `LOCALDB_DATA_DIR` | `./data` | app metadata DB, snapshots, branch files |
| `LLM_PROVIDER` | `heuristic` | `heuristic` \| `ollama` \| `anthropic` \| `openai` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `localhost:11434` / `llama3.1` | free local LLM planning |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | enable hosted planners |
| `LOCALDB_MAX_PREVIEW_ROWS` | `200` | cap on rows returned per read |
| `LOCALDB_SANDBOX_MAX_MB` | `200` | skip the clone above this DB size (static preview only) |
| `LOCALDB_SANDBOX_SAMPLE_ROWS` | `10` | sample changed rows shown from a preview |
| `LOCALDB_REQUIRE_CONFIRM_ALL` | `false` | require confirmation for every mutating op |
| `AUTH_MODE` | `single` | `single` \| `header` \| `oauth` |
| `AUTH_HEADER` | (4 common headers) | comma-separated headers to check in `header` mode |
| `AUTH_SECRET`, `AUTH_GITHUB_ID`/`_SECRET`, `AUTH_GOOGLE_ID`/`_SECRET` | — | `oauth` mode |
| `LOCALDB_MAX_DBS_PER_USER` / `_MAX_DB_MB` / `_MAX_USER_MB` | `10` / `50` / `200` | per-user quotas |
| `LOCALDB_AGENT_RATE` / `_WINDOW_S` | `30` / `300` | per-user agent-request rate limit |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

---

## Deploying

The build output (`.next/standalone/server.js`) is a self-contained Node HTTP server. It
needs **a long-lived Node process + a persistent writable volume + a streaming HTTPS proxy +
auth** — so **not** Vercel / Netlify / Lambda (`better-sqlite3` is native and it writes real
files).

- **Docker / VM / systemd** — [DEPLOYMENT.md §1–3](DEPLOYMENT.md)
- **Fly.io** — a ready [`fly.toml`](fly.toml) is included: `fly launch --no-deploy` →
  `fly volumes create localdb_data --size 1` → `fly deploy` → `fly scale count 1`
- **VPS + Caddy** — auto-HTTPS + basic auth in ~6 lines; with `AUTH_MODE=header` each
  Caddy-authenticated user gets an isolated workspace
- **Free & 24/7, no cloud bill** — run it on a device you own (Raspberry Pi, old laptop,
  mini-PC) and expose it with **Tailscale Funnel** (`tailscale funnel 3000`) or a
  **Cloudflare Tunnel** — free, stable public HTTPS URL, no card. (Cloud "always-free" tiers
  all require a payment card; the free PaaS tiers wipe your SQLite files on restart.)

Full walkthrough — including the scaling and security notes — in
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## Using the MCP server standalone

The database capability layer is also a standalone MCP server, so any MCP client gets the
exact same validation, sandboxing and safety guarantees the web app uses.

```bash
npm run mcp:stdio
```

```json
{
  "mcpServers": {
    "localdb-agent": {
      "command": "npx",
      "args": ["tsx", "src/bin/mcp-stdio.ts"],
      "env": { "LOCALDB_DB_ROOT": "/absolute/path/to/databases" }
    }
  }
}
```

| Tool | Reads/writes | Description |
|---|---|---|
| `list_tables` | read | tables + views in the database |
| `describe_table` | read | columns, indexes, foreign keys, row count for one table |
| `schema_snapshot` | read | the whole schema + row counts as a structured object |
| `query` | read-only | run `SELECT` / `EXPLAIN` / `PRAGMA`; **rejects** writes |
| `dry_run` | none | static analysis only — statement kinds, risk, destructive count, affected tables |
| `preview` | none (clone) | run the SQL on a throwaway in-memory clone; returns real statement results, schema diff, row-level changes, verification outcomes — the real DB is untouched |
| `execute` | write | run SQL in one transaction; auto-snapshots before mutations; `confirmDestructive` required for destructive SQL |
| `restore_snapshot` | write | restore a captured snapshot over the database (undo) |

---

## Architecture

Modular services, each independently testable:

```
src/lib/
  config.ts              env + paths + per-user roots
  auth.ts / auth-oauth.ts  pluggable identity (single | header | oauth)
  quota.ts               per-user database / disk / rate limits
  db/                    Drizzle query-builder schema + app metadata SQLite (isolated from user DBs)
  sqlite/
    path-safety.ts       path-traversal / extension / URI rejection; per-user confinement
    connection-manager.ts one isolated pooled connection per file (ro / rw split)
    introspect.ts        schema + row-count capture
    diff.ts              structural before/after diff
    safety.ts            statement splitter, classifier, risk model, hard blocks
    executor.ts          parameterised run + single-transaction batch
    snapshot.ts          online-backup checkpoint + restore
    sandbox.ts           in-memory clone for the truthful preview
    clone.ts             VACUUM INTO file / in-memory copy helpers
  branching.ts           fork / switch / compare / merge / discard branches
  mcp/
    tools.ts             the canonical capability layer (Zod-validated)
    server.ts            MCP server wrapper
    client.ts            in-process client used by the agent
  agent/
    providers/           heuristic | ollama | anthropic | openai (+ automatic fallback)
    prompts.ts           system/user prompt + schema serialisation
    orchestrator.ts      the 9-stage pipeline as an async event generator
  repo.ts                metadata CRUD, ownership-scoped
  sse.ts                 AsyncGenerator<AgentEvent> → text/event-stream
```

The UI (`src/components/*`) consumes SSE and never touches SQLite directly. The agent
orchestrator calls `mcp/client.ts`, which calls the exact same `mcp/tools.ts` registry the
standalone MCP server exposes — so external MCP clients inherit every guarantee.

The app-metadata schema lives in `src/lib/db/app-db.ts` (`BOOTSTRAP_SQL` +
`runInlineMigrations`) and is created / upgraded automatically on boot;
`src/lib/db/schema.ts` is the Drizzle view of the same tables used by the query builder.

---

## Data & files

| Path | Contents |
|---|---|
| `LOCALDB_DB_ROOT` (`./databases`) | user `.db` / `.sqlite` files; `u/<id>/…` per user in multi-user mode |
| `LOCALDB_DATA_DIR/app.db` | metadata: databases, branches, conversations, messages, operations, snapshots |
| `LOCALDB_DATA_DIR/snapshots/` | pre-mutation file checkpoints (one per mutating op) |
| `LOCALDB_DATA_DIR/branches/` | each branch's own `.db` copy |
| `LOCALDB_DATA_DIR/sandboxes/` | transient — scratch files for the preview clone, deleted immediately |

**Backups:** copy `LOCALDB_DB_ROOT` and `LOCALDB_DATA_DIR`. Prune old snapshots with
`find "$LOCALDB_DATA_DIR/snapshots" -name '*.db' -mtime +30 -delete`.

---

## Scripts & tests

| Script | Description |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run seed` | build `databases/demo.db` |
| `npm run mcp:stdio` | standalone MCP server (stdio) |
| `npm test` / `test:watch` | Vitest |
| `npm run typecheck` / `lint` | TypeScript / ESLint |

```bash
npm test
```

Covers: the string/comment-aware statement splitter, statement classifier, risk model and
hard blocks; path-traversal and per-user path confinement; header-mode identity parsing;
cross-user isolation and quotas; the sandbox row-diff and failure capture; the offline
planner's intent routing; and an end-to-end plan → preview → execute → verify → rollback and
branch fork → diff → merge cycle on temp databases.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pre-PR checklist and ground rules.

---

## FAQ

**Does it work fully offline?**
Yes — with `LLM_PROVIDER=heuristic` (the default) there are no network calls at all. The one
build-time exception is a webfont fetched by `next/font`; it's cached after the first build.

**Where is my data?**
On disk, next to the app — see [Data & files](#data--files). Nothing is sent anywhere unless
you opt into a hosted LLM provider.

**Can I undo a merge?**
Yes. A merge runs as a normal operation with a pre-mutation snapshot, so it shows up in
Operations with an **Undo** button like any other.

**Can multiple people use one instance?**
Yes, with `AUTH_MODE=header` or `oauth` — each gets a private, isolated workspace. See
[Multi-user](#multi-user).

**Is there a size limit on databases?**
The agent works on any size, but the truthful preview clone is skipped above
`LOCALDB_SANDBOX_MAX_MB` (falls back to static analysis). In multi-user mode uploads and
total disk are quota-capped.

**Which SQL is never allowed?**
`ATTACH` / `DETACH DATABASE`, `load_extension`, `PRAGMA writable_schema`, `VACUUM INTO` —
blocked regardless of confirmation.

---

## License

MIT — see [LICENSE](LICENSE).
