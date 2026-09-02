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

## 4. Schema

The app metadata schema (`$LOCALDB_DATA_DIR/app.db`) is created on first run and kept
current by idempotent additive migrations in `src/lib/db/app-db.ts` — no separate
migration command. When you add a column, extend both `BOOTSTRAP_SQL` and
`runInlineMigrations` there (and the Drizzle view in `src/lib/db/schema.ts`).

## 5. Backups

- **User databases**: back up `LOCALDB_DB_ROOT`.
- **Snapshots + history**: back up `LOCALDB_DATA_DIR` (`app.db` and `snapshots/`).

Snapshots accumulate one file per mutation. Prune old ones with a cron job:

```bash
find "$LOCALDB_DATA_DIR/snapshots" -name '*.db' -mtime +30 -delete
```

(Consumed snapshots can be safely deleted; the operation history keeps the metadata.)

## 6. Security notes

- The app has **no authentication** — it assumes a trusted single-user / localhost or an
  authenticating reverse proxy in front. Do **not** expose it directly to the internet.
- `LOCALDB_DB_ROOT` is a hard sandbox boundary: path traversal, absolute paths outside the
  root, non-`.db/.sqlite` extensions, and URIs are all rejected.
- Destructive SQL cannot execute without an explicit confirmation round-trip.
- Set `LOG_LEVEL=warn` in production to reduce log volume; logs are structured JSON on
  stdout/stderr.

## 7. Health check

`GET /api/config` returns 200 with the active planner and MCP tool list — use it as a
liveness/readiness probe.
