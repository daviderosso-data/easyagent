import type { AgentProvider } from "@/server/providers/types";
import {
  copilotAccountStatus,
  copilotLogout,
  copilotModels,
  copilotStartLogin,
  copilotStatus,
  copilotWaitForLogin,
  runCopilotTurn,
} from "@/server/providers/copilot/runner";

export const copilotProvider: AgentProvider = {
  id: "copilot",
  label: "Copilot (GitHub)",
  capabilities: {
    approvals: false, // headless -p is policy-only (--allow-all-tools)
    mcp: false,
    skills: false,
    resume: true, // --resume <sessionId>, verified live
    effort: true, // --effort low|medium|high|xhigh|max — same scale as ours
    slashCommands: false,
    rateLimits: false,
  },
  runTurn: runCopilotTurn,
  models: copilotModels,
  status: copilotStatus,
  account: {
    status: copilotAccountStatus,
    startLogin: copilotStartLogin, // GitHub device flow: UI shows code + URL
    waitForLogin: copilotWaitForLogin,
    logout: copilotLogout, // no CLI logout exists — switching = re-login
  },
};
