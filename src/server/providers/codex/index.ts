import type { AgentProvider } from "@/server/providers/types";
import {
  codexAccountStatus,
  codexLogout,
  codexModels,
  codexStartLogin,
  codexStatus,
  codexWaitForLogin,
  runCodexTurn,
} from "@/server/providers/codex/runner";

export const codexProvider: AgentProvider = {
  id: "codex",
  label: "Codex (ChatGPT)",
  capabilities: {
    approvals: false, // headless exec is policy-only (--ask-for-approval never)
    mcp: false,
    skills: false,
    resume: true,
    effort: true, // -c model_reasoning_effort=… (new sessions; resume keeps its own)
    slashCommands: false,
    rateLimits: false,
  },
  runTurn: runCodexTurn,
  models: codexModels,
  status: codexStatus,
  account: {
    status: codexAccountStatus,
    startLogin: codexStartLogin,
    waitForLogin: codexWaitForLogin,
    logout: codexLogout,
  },
};
