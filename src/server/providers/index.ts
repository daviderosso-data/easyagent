// Provider registry — see docs/providers.md for each engine's spike notes.

import type { AgentProvider, ProviderId } from "@/server/providers/types";
import { claudeProvider } from "@/server/providers/claude";
import { codexProvider } from "@/server/providers/codex";
import { grokProvider } from "@/server/providers/grok";
import { ollamaProvider } from "@/server/providers/ollama";

const registry = new Map<ProviderId, AgentProvider>(
  [claudeProvider, codexProvider, grokProvider, ollamaProvider].map((p) => [p.id, p]),
);

export const DEFAULT_PROVIDER_ID: ProviderId = "claude";

/** The engine used when a request names none. Always registered. */
export function defaultProvider(): AgentProvider {
  return registry.get(DEFAULT_PROVIDER_ID)!;
}

/** Resolve an engine by id (undefined/null → default). Null when unknown. */
export function getProvider(id?: string | null): AgentProvider | null {
  if (id == null || id === "") return defaultProvider();
  return registry.get(id as ProviderId) ?? null;
}

export function listProviders(): AgentProvider[] {
  return [...registry.values()];
}
