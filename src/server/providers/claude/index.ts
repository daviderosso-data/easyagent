import type { AgentProvider } from "@/server/providers/types";
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
  account: { status: accountStatus, startLogin, waitForLogin, logout },
  history: { listSessions: listProjectSessions, loadSessionItems },
};
