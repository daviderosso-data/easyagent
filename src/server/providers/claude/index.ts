import type { AgentProvider } from "@/server/providers/types";
import { MODELS } from "@/lib/models";
import { runClaudeTurn } from "@/server/providers/claude/runner";
import { listProjectSessions, loadSessionItems } from "@/server/providers/claude/sessions";
import { accountStatus, startLogin, waitForLogin, logout } from "@/server/providers/claude/account";

export const claudeProvider: AgentProvider = {
  id: "claude",
  label: "Claude Code",
  capabilities: {
    approvals: true,
    mcp: true,
    skills: true,
    resume: true,
    effort: true,
    slashCommands: true,
    rateLimits: true,
  },
  runTurn: runClaudeTurn,
  models: async () => MODELS,
  // The SDK bundles its own CLI, so the engine is always present; the only
  // variable is the subscription login.
  status: async () => ({ installed: true, loggedIn: (await accountStatus()).loggedIn }),
  account: { status: accountStatus, startLogin, waitForLogin, logout },
  history: { listSessions: listProjectSessions, loadSessionItems },
};
