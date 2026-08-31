import type { AgentPlan } from "@/lib/types";
import type { LlmProvider, PlanCallbacks, PlanRequest } from "./types";
import { toCallbacks } from "./types";
import { config } from "@/lib/config";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts";
import { parsePlan, scanSqlDrafts } from "./parse";

/** Optional: Anthropic Claude planning (requires ANTHROPIC_API_KEY). */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  isReady() {
    return !!config.anthropic.apiKey;
  }

  async plan(
    req: PlanRequest,
    cb?: PlanCallbacks | ((t: string) => void),
  ): Promise<AgentPlan> {
    const { onToken, onStatement } = toCallbacks(cb);
    let seenDrafts = 0;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropic.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: [
          ...req.history.slice(-6),
          { role: "user", content: buildUserPrompt(req.message, req.schema) },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const evt of events) {
        const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const j = JSON.parse(dataLine.slice(5).trim());
          if (j.type === "content_block_delta" && j.delta?.text) {
            full += j.delta.text;
            onToken?.(j.delta.text);
            const drafts = scanSqlDrafts(full);
            for (; seenDrafts < drafts.length; seenDrafts++) {
              onStatement?.(drafts[seenDrafts], seenDrafts);
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return parsePlan(full);
  }
}
