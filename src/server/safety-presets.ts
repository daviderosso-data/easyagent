import type { Behavior } from "@/lib/settings";
import type { RiskLevel, Severity } from "@/server/command-policy";

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** Map the profile's default behavior onto the SDK permission mode. The always-on
 *  hard gates (hook, deny/ask rules, sandbox) apply regardless of this. */
export function behaviorToMode(behavior: Behavior): PermissionMode {
  return behavior === "auto" ? "acceptEdits" : behavior === "open" ? "bypassPermissions" : "default";
}

/**
 * Tools that never need a confirmation prompt — they only read or plan. `Task` is
 * deliberately excluded (a sub-agent could invoke Bash/Write).
 */
export const READ_ONLY_TOOLS = new Set<string>([
  "Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite",
]);

/** Whether a tool call may proceed without asking the user. External MCP tools
 *  never auto-allow under ask/auto behaviors — "auto" (acceptEdits) covers file
 *  edits, not arbitrary external actions; only the Open profile lets them run
 *  silently. */
export function autoAllows(level: RiskLevel, severity: Severity, toolName: string, behavior: Behavior): boolean {
  if (level !== "normal") return false;
  if (behavior === "open") return true;
  if (severity === "mcp") return false;
  return READ_ONLY_TOOLS.has(toolName);
}
