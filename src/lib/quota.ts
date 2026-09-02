import { config } from "@/lib/config";
import { repo } from "@/lib/repo";

export interface QuotaStatus {
  databases: { used: number; limit: number };
  disk: { usedBytes: number; limitBytes: number };
}

export class LimitError extends Error {
  constructor(
    readonly response: Response,
    message: string,
  ) {
    super(message);
  }
}

export function quotaStatus(userId: string): QuotaStatus {
  return {
    databases: { used: repo.listDatabases(userId).length, limit: config.maxDbsPerUser },
    disk: { usedBytes: repo.userDiskUsage(userId), limitBytes: config.maxUserBytes },
  };
}

/** Throws LimitError (409) if creating/uploading would exceed a per-user cap. */
export function assertQuota(userId: string, opts: { newDb?: boolean; newBytes?: number } = {}) {
  const s = quotaStatus(userId);

  if (opts.newDb && s.databases.used >= s.databases.limit) {
    throw new LimitError(
      Response.json(
        { error: `Database limit reached (${s.databases.limit}). Delete one first.` },
        { status: 409 },
      ),
      "db limit",
    );
  }
  const incoming = opts.newBytes ?? 0;
  if (incoming > config.maxDbBytes) {
    throw new LimitError(
      Response.json(
        { error: `File is too large (${mb(incoming)} MB > ${mb(config.maxDbBytes)} MB limit).` },
        { status: 413 },
      ),
      "file too large",
    );
  }
  if (s.disk.usedBytes + incoming > s.disk.limitBytes) {
    throw new LimitError(
      Response.json(
        {
          error: `Storage quota exceeded (${mb(s.disk.usedBytes + incoming)} MB > ${mb(
            s.disk.limitBytes,
          )} MB). Delete a database or branch.`,
        },
        { status: 409 },
      ),
      "disk quota",
    );
  }
}

const hits = new Map<string, number[]>();

/** Throws LimitError (429) if the user is over the agent-request rate limit. */
export function assertRate(userId: string) {
  const now = Date.now();
  const window = config.agentRateWindowMs;
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < window);
  if (recent.length >= config.agentRate) {
    const retry = Math.ceil((window - (now - recent[0])) / 1000);
    throw new LimitError(
      Response.json(
        { error: `Rate limit: ${config.agentRate} requests / ${window / 1000}s. Retry in ${retry}s.` },
        { status: 429, headers: { "retry-after": String(retry) } },
      ),
      "rate limit",
    );
  }
  recent.push(now);
  hits.set(userId, recent);
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
