import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { LlmProvider } from "./types";
import { HeuristicProvider } from "./heuristic";
import { OllamaProvider } from "./ollama";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";

export type { LlmProvider, PlanRequest } from "./types";

const heuristic = new HeuristicProvider();

function make(name: string): LlmProvider {
  switch (name) {
    case "ollama":
      return new OllamaProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
      return new OpenAiProvider();
    case "heuristic":
    default:
      return heuristic;
  }
}

/**
 * Resolve the configured provider, falling back to the offline heuristic
 * planner if the primary one is not actually reachable/configured.
 */
export async function resolveProvider(): Promise<{ provider: LlmProvider; fellBack: boolean }> {
  const primary = make(config.llmProvider);
  if (primary.name === "heuristic") return { provider: primary, fellBack: false };
  try {
    const ready = await primary.isReady();
    if (ready) return { provider: primary, fellBack: false };
    logger.warn("provider not ready, using heuristic", { provider: primary.name });
  } catch (err) {
    logger.warn("provider readiness check threw", { provider: primary.name, err: String(err) });
  }
  return { provider: heuristic, fellBack: true };
}

export { heuristic as heuristicProvider };
