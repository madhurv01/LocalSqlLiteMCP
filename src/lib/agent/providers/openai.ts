import type { AgentPlan } from "@/lib/types";
import type { LlmProvider, PlanCallbacks, PlanRequest } from "./types";
import { toCallbacks } from "./types";
import { config } from "@/lib/config";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts";
import { parsePlan, scanSqlDrafts } from "./parse";

/** Optional: OpenAI planning (requires OPENAI_API_KEY). */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";

  isReady() {
    return !!config.openai.apiKey;
  }

  async plan(
    req: PlanRequest,
    cb?: PlanCallbacks | ((t: string) => void),
  ): Promise<AgentPlan> {
    const { onToken, onStatement } = toCallbacks(cb);
    let seenDrafts = 0;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.openai.model,
        temperature: 0.1,
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...req.history.slice(-6),
          { role: "user", content: buildUserPrompt(req.message, req.schema) },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
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
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const chunk = j.choices?.[0]?.delta?.content ?? "";
          if (chunk) {
            full += chunk;
            onToken?.(chunk);
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
