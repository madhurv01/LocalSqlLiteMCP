# Deployment

LocalDB Agent is **local-first**. It reads and writes SQLite files on the machine (or
container) it runs on, so it is designed to be self-hosted rather than deployed to a
serverless edge.

## Requirements

- Node.js 20+ (22 recommended)
- A writable filesystem for `LOCALDB_DATA_DIR` (app metadata + snapshots) and
  `LOCALDB_DB_ROOT` (user databases)
- Build toolchain for the `better-sqlite3` native addon (`python3`, `make`, a C++ compiler)
  — only needed at install/build time; prebuilt binaries cover most platforms

## 1. Bare metal / VM

```bash
git clone <repo> && cd localdb-agent
npm ci
npm run build

export NODE_ENV=production
export LOCALDB_DATA_DIR=/var/lib/localdb-agent
export LOCALDB_DB_ROOT=/srv/databases
export LLM_PROVIDER=heuristic      # or ollama / anthropic / openai
node .next/standalone/server.js    # serves on $PORT (default 3000)
```

Run it under a process manager (systemd, pm2). Example systemd unit:

```ini
[Unit]
Description=LocalDB Agent
After=network.target

[Service]
WorkingDirectory=/opt/localdb-agent
Environment=NODE_ENV=production
Environment=LOCALDB_DATA_DIR=/var/lib/localdb-agent
Environment=LOCALDB_DB_ROOT=/srv/databases
Environment=LLM_PROVIDER=heuristic
ExecStart=/usr/bin/node /opt/localdb-agent/.next/standalone/server.js
Restart=on-failure
User=localdb

[Install]
WantedBy=multi-user.target
```

## 2. Docker

```bash
docker compose up --build -d
```

- `./databases` on the host is bind-mounted to `/databases` in the container.
- App metadata and snapshots persist in the named volume `localdb-data`.
- To use a host Ollama from the container, the compose file already sets
  `OLLAMA_BASE_URL=http://host.docker.internal:11434` and adds the host-gateway.

Build the image directly:

```bash
docker build -t localdb-agent .
docker run -p 3000:3000 \
  -v "$PWD/databases:/databases" \
  -v localdb-data:/data \
  -e LLM_PROVIDER=heuristic \
  localdb-agent
```

## 3. Reverse proxy

Put Nginx/Caddy in front for TLS. **Disable response buffering** so Server-Sent Events
stream in real time:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Caddy needs no special config (`reverse_proxy 127.0.0.1:3000`).

## 4. Deploy it globally

The build output (`.next/standalone/server.js`) is a single Node HTTP server. Any host
that gives you **(a) a long-lived Node process, (b) a persistent writable volume, (c) an
HTTPS proxy that streams responses, and (d) authentication** works. It is **not** a fit
for Vercel / Netlify / Lambda (`better-sqlite3` is native + it needs a real filesystem).

### Fly.io (recommended)

```bash
fly launch --no-deploy                       # detects the Dockerfile
fly volumes create localdb_data --size 1
```

`fly.toml`:

```toml
[env]
  LOCALDB_DATA_DIR = "/data"
  LOCALDB_DB_ROOT  = "/data/databases"
  LLM_PROVIDER     = "heuristic"
  AUTH_MODE        = "header"                 # or "oauth"

[[mounts]]
  source = "localdb_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  min_machines_running = 1

# keep it single-instance — see "Scaling" below
```

```bash
fly deploy && fly scale count 1
```

Put **Cloudflare Access** (Zero Trust → self-hosted app) in front of the Fly hostname for
`header` mode, or configure `oauth` (below).

### Any VPS ($5/mo) + Caddy

```bash
docker compose up -d
```

`Caddyfile` — auto-HTTPS **and** basic auth in one place:

```
db.example.com {
    basic_auth {
        alice $2a$14$<bcrypt-hash>
    }
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Auth-Request-Email {http.auth.user.id}
    }
}
```

With `AUTH_MODE=header` Caddy passes the authenticated username through and each user
gets an isolated workspace.

### Keep the data on your own machine

Run it locally and expose it with **`cloudflared tunnel`** or **`tailscale funnel 3000`** —
no open ports, and Cloudflare Access / Tailscale ACLs provide auth for free.

## 5. Multi-user

Set `AUTH_MODE` (default `single` = no auth, one shared workspace):

| Mode | Identity source | Setup |
|---|---|---|
| `single` | none — user `local` | nothing (current default) |
| `header` | a trusted reverse-proxy header | Cloudflare Access / oauth2-proxy / nginx `auth_request` in front; set `AUTH_HEADER` if not one of the defaults |
| `oauth` | GitHub / Google via Auth.js | `AUTH_SECRET` + `AUTH_GITHUB_ID`/`_SECRET` (and/or Google); callback `https://<host>/api/auth/callback/github` |

In `header`/`oauth` mode:

- each user gets `$LOCALDB_DB_ROOT/u/<id>/` — they only ever see and operate their own
  databases; every API route is ownership-checked (cross-user access returns 404).
- users **upload** a `.db`/`.sqlite` from the browser or **create** one; the file's SQLite
  magic is validated and it is size-capped.
- per-user quotas (`LOCALDB_MAX_DBS_PER_USER`, `LOCALDB_MAX_DB_MB`, `LOCALDB_MAX_USER_MB`)
  and an agent-request rate limit (`LOCALDB_AGENT_RATE` / `_WINDOW_S`) are enforced.

**oauth2-proxy example** (`header` mode) — sits in front, injects `X-Auth-Request-Email`:

```bash
oauth2-proxy \
  --provider=github --email-domain='*' \
  --upstream=http://127.0.0.1:3000 \
  --set-xauthrequest=true \
  --cookie-secret=<32b> --client-id=<id> --client-secret=<secret>
```

**Scaling:** run **one instance**. The SQLite connection pool, active-branch state, and
local files are per-process, and `better-sqlite3` is synchronous — scale *up* (a bigger
machine), never *out*. The sandbox-preview clone (`LOCALDB_SANDBOX_MAX_MB`) bounds the
worst-case blocking time.

The standalone MCP server (`npm run mcp:stdio`) is operator-run and single-user by nature —
it operates on `LOCALDB_DB_ROOT` directly with no auth. Run one per operator.

## 6. Schema

The app metadata schema (`$LOCALDB_DATA_DIR/app.db`) is created on first run and kept
current by idempotent additive migrations in `src/lib/db/app-db.ts` — no separate
migration command. When you add a column, extend both `BOOTSTRAP_SQL` and
`runInlineMigrations` there (and the Drizzle view in `src/lib/db/schema.ts`).

## 7. Backups

- **User databases**: back up `LOCALDB_DB_ROOT`.
- **Snapshots + history**: back up `LOCALDB_DATA_DIR` (`app.db` and `snapshots/`).

Snapshots accumulate one file per mutation. Prune old ones with a cron job:

```bash
find "$LOCALDB_DATA_DIR/snapshots" -name '*.db' -mtime +30 -delete
```

(Consumed snapshots can be safely deleted; the operation history keeps the metadata.)

## 8. Security notes

- With `AUTH_MODE=single` (the default) there is **no authentication** — run it on
  localhost or behind an authenticating proxy. For internet exposure use `header` or
  `oauth`, or put Cloudflare Access / Tailscale / basic-auth in front.
- In `header` mode the app **trusts** the identity header — the app must be reachable
  *only* through the proxy that sets it, never directly.
- Per-user path confinement: a user can only reach files under `$LOCALDB_DB_ROOT/u/<id>/`;
  traversal, absolute paths outside it, non-`.db/.sqlite` extensions and URIs are rejected.
- Uploads are validated by SQLite magic bytes and size-capped.
- Destructive SQL cannot execute without an explicit confirmation round-trip; `ATTACH`,
  `load_extension`, `PRAGMA writable_schema` and `VACUUM INTO` are always blocked.
- Set `LOG_LEVEL=warn` in production; logs are structured JSON on stdout/stderr.

## 9. Health check

`GET /api/config` returns 200 with the active planner and MCP tool list — use it as a
liveness/readiness probe.
