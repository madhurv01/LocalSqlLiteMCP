# syntax=docker/dockerfile:1

# ---- deps ----------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    LOCALDB_DATA_DIR=/data \
    LOCALDB_DB_ROOT=/databases \
    PORT=3000

RUN useradd -m app && mkdir -p /data /databases && chown -R app:app /data /databases

COPY --from=build /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# better-sqlite3 native binding must come from the full node_modules
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

USER app
VOLUME ["/data", "/databases"]
EXPOSE 3000
CMD ["node", "server.js"]
