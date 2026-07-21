import type { AgentProvider } from "@/server/providers/types";
import {
  grokAccountStatus,
  grokLogout,
  grokModels,
  grokStartLogin,
  grokStatus,
  grokWaitForLogin,
  runGrokTurn,
} from "@/server/providers/grok/runner";

export const grokProvider: AgentProvider = {
  id: "grok",
  label: "Grok Build",
  capabilities: {
    approvals: false, // headless is policy-only; interactive approvals need ACP (later)
    mcp: false,
    skills: false,
    resume: true,
    effort: true,
    slashCommands: false,
    rateLimits: false,
  },
  runTurn: runGrokTurn,
  models: grokModels,
  status: grokStatus,
  account: {
    status: grokAccountStatus,
    startLogin: grokStartLogin,
    waitForLogin: grokWaitForLogin,
    logout: grokLogout,
  },
};
