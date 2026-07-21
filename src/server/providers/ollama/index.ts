import type { AgentProvider } from "@/server/providers/types";
import { ollamaModels, ollamaStatus, runOllamaTurn } from "@/server/providers/ollama/runner";

export const ollamaProvider: AgentProvider = {
  id: "ollama",
  label: "Ollama (local)",
  capabilities: {
    approvals: false,
    mcp: false,
    skills: false,
    resume: true,
    effort: false,
    slashCommands: false,
    rateLimits: false,
  },
  runTurn: runOllamaTurn,
  models: ollamaModels,
  status: ollamaStatus,
};
