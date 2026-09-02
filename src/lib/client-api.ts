import type { AgentEvent } from "@/lib/types";

/** On 401, send the browser to the login page (oauth) or surface a clear error. */
function handleUnauthorized(): never {
  if (typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = `/login?from=${encodeURIComponent(location.pathname)}`;
  }
  throw new Error("Not signed in.");
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isForm
      ? (init?.headers ?? {})
      : { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401) handleUnauthorized();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return body as T;
}

/**
 * POST a JSON body and consume a text/event-stream response, invoking `onEvent`
 * for every parsed AgentEvent. Resolves when the stream ends.
 */
export async function streamAgent(
  url: string,
  body: unknown,
  onEvent: (evt: AgentEvent | { type: "end" }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: `Stream failed (${res.status})` }));
    throw new Error((err as { error?: string }).error || "Stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine.slice(5).trim());
        onEvent(parsed);
      } catch {
        /* ignore keep-alive / malformed */
      }
    }
  }
}
