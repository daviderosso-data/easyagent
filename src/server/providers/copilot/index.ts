import type { AgentProvider } from "@/server/providers/types";
import { copilotModels, copilotStatus, runCopilotTurn } from "@/server/providers/copilot/runner";

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
  // No account facet: login comes from the user's gh CLI (or `copilot login`
  // run once in a terminal) — the Engine doctor explains whichever is missing.
};
