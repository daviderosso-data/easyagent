import type { Behavior } from "@/lib/settings";

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
