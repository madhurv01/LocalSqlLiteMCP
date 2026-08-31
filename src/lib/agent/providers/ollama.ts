import type { AgentPlan } from "@/lib/types";
import type { LlmProvider, PlanCallbacks, PlanRequest } from "./types";
import { toCallbacks } from "./types";
import { config } from "@/lib/config";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts";
import { parsePlan, scanSqlDrafts } from "./parse";

/** Free local LLM planning via Ollama. */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async plan(
    req: PlanRequest,
    cb?: PlanCallbacks | ((t: string) => void),
  ): Promise<AgentPlan> {
    const { onToken, onStatement } = toCallbacks(cb);
    let seenDrafts = 0;
    const res = await fetch(`${config.ollama.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollama.model,
        stream: true,
        format: "json",
        options: { temperature: 0.1 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...req.history.slice(-6),
          { role: "user", content: buildUserPrompt(req.message, req.schema) },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const chunk = j.message?.content ?? "";
          if (chunk) {
            full += chunk;
            onToken?.(chunk);
            const drafts = scanSqlDrafts(full);
            for (; seenDrafts < drafts.length; seenDrafts++) {
              onStatement?.(drafts[seenDrafts], seenDrafts);
            }
          }
        } catch {
          /* ignore keep-alive lines */
        }
      }
    }
    return parsePlan(full);
  }
}
