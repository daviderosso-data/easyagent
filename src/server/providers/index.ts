// Provider registry. P5 registers only Claude; P6 adds the login-based CLIs
// (Codex, Gemini) and local Ollama — see docs/providers.md.

import type { AgentProvider, ProviderId } from "@/server/providers/types";
import { claudeProvider } from "@/server/providers/claude";

const registry = new Map<ProviderId, AgentProvider>([[claudeProvider.id, claudeProvider]]);

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
